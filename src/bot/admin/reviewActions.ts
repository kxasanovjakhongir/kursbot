import { InlineKeyboard, type Api } from "grammy";
import { contactAdminKeyboard, reviewKeyboard } from "../keyboards";
import { notifyUser, sendToAdminGroup } from "../notify";
import { buildReceiptCaption } from "./receiptCard";
import { escapeHtml, formatSum } from "../../lib/format";
import { logger } from "../../lib/logger";
import type { OrderStatus } from "@prisma/client";
import { approveOrder, getOrderFull, rejectOrder, transition, type ReviewerRef } from "../../services/orders";
import { KickFailedError, revokeGrant } from "../../services/membership";
import { grantAccess } from "../../services/access";
import { trackEvent } from "../../services/events";
import { displayCourseName, getSettings } from "../../services/settings";
import { REJECT_REASONS, type RejectReasonCode } from "../../services/texts";
import { label, translate } from "../../i18n";
import { displayName, userLang } from "../../services/users";
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
  await syncCards(api, orderId, clicked);
  await deliverApproved(api, orderId);
  return true;
}

/**
 * Tasdiqlangan (to'langan) buyurtma bo'yicha: kanal(lar)ga kirish beriladi va mijozga xabar yuboriladi.
 * Admin tasdiqlashi ham, onlayn to'lov (Payme / Click) ham shuni chaqiradi.
 */
export async function deliverApproved(api: Api, orderId: bigint): Promise<void> {
  const order = (await getOrderFull(orderId))!;
  await trackEvent(order.userId, "approved", { orderId: orderId.toString(), product: order.product.code, method: order.paymentMethod });

  let grants: Awaited<ReturnType<typeof grantAccess>> = [];
  try {
    grants = await grantAccess(api, order, order.user.telegramId);
  } catch (err) {
    logger.error({ err, orderId: orderId.toString() }, "kirish berilmadi");
  }
  const withLinks = grants.filter((g) => g.inviteLink);
  const settings = await getSettings();
  // Mijozga o'z tilida
  const lang = await userLang(order.user);

  // Tasdiqlash bazada bajarildi — xabar yuborilmasa ham (tarmoq) admin qayta tasdiqlashga urinmasin
  let sent = null;
  try {
    const kb = new InlineKeyboard();
    for (const g of withLinks) kb.url(label(lang, "btn_join", { mahsulot: await displayCourseName(g.product.title) }), g.inviteLink!).row();
    // Kurs sahifasi: darslar va kanal havolasi (to'plam bo'lsa — tarkibidagi kurslar)
    kb.text(label(lang, "btn_start_course"), `p:${order.product.code}`);
    const text = withLinks.length > 0 ? await translate(lang, "approved", { kun: settings.invite_link_days }) : await translate(lang, "approved_no_link");
    sent = await notifyUser(api, order.user, "success", text, { reply_markup: kb });
  } catch (err) {
    logger.error({ err, orderId: orderId.toString() }, "tasdiqlash xabari mijozga yuborilmadi");
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
    await sendToAdminGroup(api, `⚠️ Buyurtma #${orderId}: mijozga xabar yetkazilmadi (botni bloklagan yoki chat topilmadi). Link botdagi kurs sahifasida («📚 Darsliklar» → kurs → «🔗 Kanal havolasi»).`).catch(() => undefined);
  }
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
  const stored =
    code === "short" ? `${reason.label} (${formatSum(shortfall ?? 0)})` : code === "other" ? `${reason.label}: ${extra}` : reason.label;

  const ok = await rejectOrder(orderId, reviewer, stored, shortfall);
  await syncCards(api, orderId, clicked);
  if (!ok) return { ok: false, stored };

  const order = (await getOrderFull(orderId))!;
  await trackEvent(order.userId, "rejected", { orderId: orderId.toString(), reason: code });
  const settings = await getSettings();
  const lang = await userLang(order.user);
  // Sabab mijoz tilida; qiymatlar (summa, admin matni) escape qilinadi
  const customerText = await translate(lang, reason.textKey, {
    farq: shortfall ? formatSum(shortfall) : "",
    matn: code === "other" ? (extra ?? "") : "",
  });
  const kb = new InlineKeyboard();
  if (reason.resend && order.attempts < settings.max_receipt_attempts) kb.text(label(lang, "btn_resend"), "resend");
  const contact = await contactAdminKeyboard(lang);
  for (const row of contact?.inline_keyboard ?? []) kb.row(...row);

  const sent = await notifyUser(api, order.user, "warning", await translate(lang, "rejected", {}, { sabab: customerText }), { reply_markup: kb }).catch((err) => {
    logger.error({ err, orderId: orderId.toString() }, "rad etish xabari mijozga yuborilmadi");
    return null;
  });
  if (!sent) {
    await sendToAdminGroup(api, `⚠️ Buyurtma #${orderId}: mijoz (${escapeHtml(displayName(order.user))}) botni bloklagan.`).catch(() => undefined);
  }
  return { ok: true, stored };
}

export type CancelResult =
  | { ok: true; status: "cancelled" | "refunded"; revoked: number }
  | { ok: false; reason: "not_found" | "closed" }
  | { ok: false; reason: "kick_failed"; product: string };

const CANCELLABLE_OPEN: OrderStatus[] = ["new", "receipt_sent", "rejected"];
const CANCELLABLE_PAID: OrderStatus[] = ["approved", "joined"];

/**
 * Admin paneldan bekor qilish:
 * - ochiq buyurtma (to'lov kutilmoqda / chek tekshirilmoqda / rad etilgan) → cancelled;
 * - to'langan (tasdiqlangan / kanalga qo'shilgan) → refunded, mijoz shu buyurtma bergan kanallardan chiqariladi.
 * Kanaldan chiqarib bo'lmasa (bot huquqi yo'q) — status o'zgarmaydi. Mijozga sabab bilan xabar boradi.
 */
export async function cancelAndNotify(api: Api, orderId: bigint, by: { panelUserId: number }, reason: string | null): Promise<CancelResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, product: true, grants: { where: { revokedAt: null }, include: { product: true, user: true } } },
  });
  if (!order) return { ok: false, reason: "not_found" };
  const paid = CANCELLABLE_PAID.includes(order.status);
  if (!paid && !CANCELLABLE_OPEN.includes(order.status)) return { ok: false, reason: "closed" };

  let revoked = 0;
  if (paid) {
    for (const grant of order.grants) {
      try {
        await revokeGrant(api, grant, "removed", { notify: false });
        revoked++;
      } catch (err) {
        if (err instanceof KickFailedError) return { ok: false, reason: "kick_failed", product: err.productTitle };
        throw err;
      }
    }
  }

  const to = paid ? "refunded" : "cancelled";
  const ok = await transition(orderId, paid ? CANCELLABLE_PAID : CANCELLABLE_OPEN, to, {
    cancelledAt: new Date(),
    cancelledById: by.panelUserId,
    cancelReason: reason,
  });
  if (!ok) return { ok: false, reason: "closed" };

  // Chek tekshirilayotgan bo'lsa — guruhdagi kartochkadan tugmalar olinadi
  await syncCards(api, orderId);
  await trackEvent(order.userId, "order_cancelled", { orderId: orderId.toString(), by: "admin" });

  if (!order.user.isBanned) {
    const lang = await userLang(order.user);
    const sabab = reason ? await translate(lang, "order_cancel_reason", { sabab: reason }) : "";
    const text = await translate(lang, paid ? "order_refunded_by_admin" : "order_cancelled_by_admin", { raqam: orderId.toString(), mahsulot: await displayCourseName(order.product.title) }, { sabab });
    await notifyUser(api, order.user, "order", text, { reply_markup: await contactAdminKeyboard(lang) }).catch((err) =>
      logger.warn({ err, orderId: orderId.toString() }, "bekor qilish xabari yuborilmadi"),
    );
  }
  return { ok: true, status: to, revoked };
}
