import { InlineKeyboard, type Api } from "grammy";
import { contactAdminKeyboard, reviewKeyboard } from "../keyboards";
import { sendToAdminGroup, sendToUser } from "../notify";
import { buildReceiptCaption } from "./receiptCard";
import { escapeHtml, formatSum } from "../../lib/format";
import { logger } from "../../lib/logger";
import { approveOrder, getOrderFull, rejectOrder, type ReviewerRef } from "../../services/orders";
import { grantAccess } from "../../services/access";
import { trackEvent } from "../../services/events";
import { getSettings } from "../../services/settings";
import { fill, REJECT_REASONS, t, type RejectReasonCode } from "../../services/texts";
import { displayName } from "../../services/users";
import { prisma } from "../../db";

/**
 * Chekni tasdiqlash / rad etish — Telegram tugmalari ham, admin panel ham shu funksiyalarni chaqiradi.
 * Qaysi joydan bosilishidan qat'i nazar: mijozga xabar boradi va admin guruhidagi kartochka yangilanadi.
 */

export interface CardRef {
  chatId: number;
  messageId: number;
  isMedia: boolean;
}

/** Chek kartochkasini (guruhdagi asl xabar va bosilgan nusxa) joriy holatga yangilaydi */
export async function syncCards(api: Api, orderId: bigint, clicked?: CardRef): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return;
  const caption = await buildReceiptCaption(orderId);
  const reply_markup = order.status === "receipt_sent" ? reviewKeyboard(orderId) : new InlineKeyboard();

  const refs: CardRef[] = [];
  const receipt = await prisma.receipt.findFirst({ where: { orderId }, orderBy: { id: "desc" } });
  if (receipt?.adminChatId && receipt.adminMessageId) {
    refs.push({ chatId: Number(receipt.adminChatId), messageId: Number(receipt.adminMessageId), isMedia: true });
  }
  if (clicked && !refs.some((r) => r.chatId === clicked.chatId && r.messageId === clicked.messageId)) refs.push(clicked);

  for (const r of refs) {
    const edit = r.isMedia
      ? api.editMessageCaption(r.chatId, r.messageId, { caption, parse_mode: "HTML", reply_markup })
      : api.editMessageText(r.chatId, r.messageId, caption, { parse_mode: "HTML", reply_markup });
    await edit.catch((err: unknown) => {
      const desc = err instanceof Error ? err.message : String(err);
      if (!desc.includes("not modified")) logger.warn({ err }, "kartochka yangilanmadi");
    });
  }
}

/** Tasdiqlash: atomik (BR-12), keyin shaxsiy kanal linki mijozga yuboriladi. false — allaqachon ko'rib chiqilgan */
export async function approveAndNotify(api: Api, orderId: bigint, reviewer: ReviewerRef, clicked?: CardRef): Promise<boolean> {
  const ok = await approveOrder(orderId, reviewer);
  if (!ok) {
    await syncCards(api, orderId, clicked);
    return false;
  }
  const order = (await getOrderFull(orderId))!;
  await trackEvent(order.userId, "approved", { orderId: orderId.toString(), product: order.product.code });
  await syncCards(api, orderId, clicked);

  let grants: Awaited<ReturnType<typeof grantAccess>> = [];
  try {
    grants = await grantAccess(api, order, order.user.telegramId);
  } catch (err) {
    logger.error({ err, orderId: orderId.toString() }, "kirish berilmadi");
  }
  const withLinks = grants.filter((g) => g.inviteLink);
  const settings = await getSettings();

  let sent;
  if (withLinks.length > 0) {
    const kb = new InlineKeyboard();
    for (const g of withLinks) kb.url(await t("btn_join", { mahsulot: g.product.title }), g.inviteLink!).row();
    sent = await sendToUser(api, order.user.telegramId, await t("approved", { kun: settings.invite_link_days }), { reply_markup: kb });
  } else {
    sent = await sendToUser(api, order.user.telegramId, await t("approved_no_link"));
  }

  const missing = grants.filter((g) => !g.inviteLink).map((g) => g.product.title);
  if (grants.length === 0 || missing.length > 0) {
    await sendToAdminGroup(
      api,
      `⚠️ Buyurtma #${orderId}: kanal linki yaratilmadi (${escapeHtml(missing.join(", ") || order.product.title)}). ` +
        `Kanal ID va bot huquqlarini tekshiring (/products).`,
    ).catch(() => undefined);
  }
  if (!sent) {
    await sendToAdminGroup(api, `⚠️ Buyurtma #${orderId}: mijoz botni bloklagan — link yetkazilmadi.`).catch(() => undefined);
  }
  return true;
}

/** Rad etish (TZ 7.3). extra: "short" uchun yetishmayotgan summa, "other" uchun erkin matn */
export async function rejectAndNotify(
  api: Api,
  orderId: bigint,
  code: RejectReasonCode,
  extra: string | null,
  reviewer: ReviewerRef,
  clicked?: CardRef,
): Promise<{ ok: boolean; stored: string }> {
  const reason = REJECT_REASONS[code];
  const shortfall = code === "short" && extra ? Number(extra) : null;
  const customerText = fill(reason.text, {
    farq: shortfall ? formatSum(shortfall) : "",
    matn: code === "other" ? (extra ?? "") : "",
  });
  const stored =
    code === "short" ? `${reason.label} (${formatSum(shortfall ?? 0)})` : code === "other" ? `${reason.label}: ${extra}` : reason.label;

  const ok = await rejectOrder(orderId, reviewer, stored, shortfall);
  await syncCards(api, orderId, clicked);
  if (!ok) return { ok: false, stored };

  const order = (await getOrderFull(orderId))!;
  await trackEvent(order.userId, "rejected", { orderId: orderId.toString(), reason: code });
  const settings = await getSettings();
  const kb = new InlineKeyboard();
  if (reason.resend && order.attempts < settings.max_receipt_attempts) kb.text(await t("btn_resend"), "resend").row();
  kb.add(contactAdminKeyboard().inline_keyboard[0][0]);

  const sent = await sendToUser(api, order.user.telegramId, await t("rejected", {}, { sabab: customerText }), { reply_markup: kb });
  if (!sent) {
    await sendToAdminGroup(api, `⚠️ Buyurtma #${orderId}: mijoz (${escapeHtml(displayName(order.user))}) botni bloklagan.`).catch(() => undefined);
  }
  return { ok: true, stored };
}
