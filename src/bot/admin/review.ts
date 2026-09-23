import { Composer, InlineKeyboard, type Api } from "grammy";
import type { Admin } from "@prisma/client";
import type { BotContext } from "../context";
import { contactAdminKeyboard, reviewKeyboard } from "../keyboards";
import { sendToAdminGroup, sendToUser } from "../notify";
import { buildReceiptCaption } from "./receiptCard";
import { escapeHtml, formatSum } from "../../lib/format";
import { logger } from "../../lib/logger";
import { approveOrder, getOrderFull, rejectOrder } from "../../services/orders";
import { grantAccess } from "../../services/access";
import { audit, trackEvent } from "../../services/events";
import { getSettings } from "../../services/settings";
import { fill, isRejectReason, REJECT_REASONS, t, type RejectReasonCode } from "../../services/texts";
import { displayName } from "../../services/users";
import { prisma } from "../../db";

export const review = new Composer<BotContext>();

interface CardRef {
  chatId: number;
  messageId: number;
  isMedia: boolean;
}

/** Chek kartochkasini (guruhdagi asl xabar va bosilgan nusxa) joriy holatga yangilaydi */
async function syncCards(api: Api, orderId: bigint, clicked?: CardRef): Promise<void> {
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
    await edit.catch((err) => {
      if (!String(err?.description ?? err).includes("not modified")) logger.warn({ err }, "kartochka yangilanmadi");
    });
  }
}

function clickedRef(ctx: BotContext): CardRef | undefined {
  const m = ctx.callbackQuery?.message;
  if (!m) return undefined;
  return { chatId: m.chat.id, messageId: m.message_id, isMedia: !!(m.photo || m.document) };
}

// Admin tugmalari har safar ID bo'yicha qayta tekshiriladi (TZ 11.5)
review.callbackQuery(/^adm:/, async (ctx, next) => {
  if (!ctx.admin) {
    await ctx.answerCallbackQuery({ text: "Ruxsat yo'q", show_alert: true });
    return;
  }
  await next();
});

// ---------- Tasdiqlash ----------
review.callbackQuery(/^adm:ap:(\d+)$/, async (ctx) => {
  const orderId = BigInt(ctx.match[1]);
  const admin = ctx.admin!;
  const ok = await approveOrder(orderId, admin.id);
  if (!ok) {
    // BR-12: ikkinchi admin
    await ctx.answerCallbackQuery({ text: "Bu chek allaqachon ko'rib chiqilgan", show_alert: true });
    await syncCards(ctx.api, orderId, clickedRef(ctx));
    return;
  }
  await ctx.answerCallbackQuery({ text: "Tasdiqlandi ✅" });
  await audit(admin.id, "approve", "order", orderId, { status: "receipt_sent" }, { status: "approved" });

  const order = (await getOrderFull(orderId))!;
  await trackEvent(order.userId, "approved", { orderId: orderId.toString(), product: order.product.code });
  await syncCards(ctx.api, orderId, clickedRef(ctx));

  let grants: Awaited<ReturnType<typeof grantAccess>> = [];
  try {
    grants = await grantAccess(ctx.api, order, order.user.telegramId);
  } catch (err) {
    logger.error({ err, orderId: orderId.toString() }, "kirish berilmadi");
  }
  const withLinks = grants.filter((g) => g.inviteLink);
  const settings = await getSettings();

  let sent;
  if (withLinks.length > 0) {
    const kb = new InlineKeyboard();
    for (const g of withLinks) kb.url(await t("btn_join", { mahsulot: g.product.title }), g.inviteLink!).row();
    sent = await sendToUser(ctx.api, order.user.telegramId, await t("approved", { kun: settings.invite_link_days }), {
      reply_markup: kb,
    });
  } else {
    sent = await sendToUser(ctx.api, order.user.telegramId, await t("approved_no_link"));
  }

  const missing = grants.filter((g) => !g.inviteLink).map((g) => g.product.title);
  if (grants.length === 0 || missing.length > 0) {
    await sendToAdminGroup(
      ctx.api,
      `⚠️ Buyurtma #${orderId}: kanal linki yaratilmadi (${escapeHtml(missing.join(", ") || order.product.title)}). ` +
        `Kanal ID va bot huquqlarini tekshiring (/products).`,
    );
  }
  if (!sent) {
    await sendToAdminGroup(ctx.api, `⚠️ Buyurtma #${orderId}: mijoz botni bloklagan — link yetkazilmadi.`);
  }
});

// ---------- Rad etish ----------
function reasonsKeyboard(orderId: bigint): InlineKeyboard {
  const kb = new InlineKeyboard();
  (Object.keys(REJECT_REASONS) as RejectReasonCode[]).forEach((code, i) => {
    kb.text(REJECT_REASONS[code].label, `adm:rr:${orderId}:${code}`);
    if (i % 2 === 1) kb.row();
  });
  return kb.row().text("⬅️ Orqaga", `adm:bk:${orderId}`);
}

review.callbackQuery(/^adm:rj:(\d+)$/, async (ctx) => {
  const orderId = BigInt(ctx.match[1]);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (order?.status !== "receipt_sent") {
    await ctx.answerCallbackQuery({ text: "Bu chek allaqachon ko'rib chiqilgan", show_alert: true });
    await syncCards(ctx.api, orderId, clickedRef(ctx));
    return;
  }
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: reasonsKeyboard(orderId) });
});

review.callbackQuery(/^adm:bk:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await syncCards(ctx.api, BigInt(ctx.match[1]), clickedRef(ctx));
});

/** "Summa kam" va "Boshqa" uchun admin qo'shimcha ma'lumot yozadi */
const pendingInput = new Map<number, { orderId: bigint; code: RejectReasonCode; card?: CardRef; at: number }>();

review.callbackQuery(/^adm:rr:(\d+):(\w+)$/, async (ctx) => {
  const orderId = BigInt(ctx.match[1]);
  const code = ctx.match[2];
  if (!isRejectReason(code)) return ctx.answerCallbackQuery();

  if (code === "short" || code === "other") {
    await ctx.answerCallbackQuery();
    pendingInput.set(ctx.from.id, { orderId, code, card: clickedRef(ctx), at: Date.now() });
    const prompt =
      code === "short"
        ? `Buyurtma #${orderId}: yetishmayotgan summani yozing (masalan, 50000).`
        : `Buyurtma #${orderId}: mijozga boradigan rad etish sababini yozing.`;
    await ctx.reply(prompt, {
      reply_markup: { force_reply: true, selective: true },
      reply_parameters: ctx.callbackQuery.message ? { message_id: ctx.callbackQuery.message.message_id } : undefined,
    });
    return;
  }
  const done = await finishReject(ctx.api, ctx.admin!, orderId, code, null, clickedRef(ctx));
  await ctx.answerCallbackQuery(done ? { text: "Rad etildi" } : { text: "Bu chek allaqachon ko'rib chiqilgan", show_alert: true });
});

review.on("message:text", async (ctx, next) => {
  const pending = ctx.admin ? pendingInput.get(ctx.from.id) : undefined;
  if (!pending || Date.now() - pending.at > 15 * 60_000 || ctx.message.text.startsWith("/")) return next();
  pendingInput.delete(ctx.from.id);

  let extra: string;
  if (pending.code === "short") {
    const amount = Number(ctx.message.text.replace(/\D/g, ""));
    if (!amount) {
      pendingInput.set(ctx.from.id, { ...pending, at: Date.now() });
      await ctx.reply("Summani raqam bilan yozing, masalan: 50000");
      return;
    }
    extra = String(amount);
  } else {
    extra = ctx.message.text.trim().slice(0, 500);
  }
  const done = await finishReject(ctx.api, ctx.admin!, pending.orderId, pending.code, extra, pending.card);
  await ctx.reply(done ? `Buyurtma #${pending.orderId} rad etildi.` : "Bu chek allaqachon ko'rib chiqilgan.");
});

async function finishReject(
  api: Api,
  admin: Admin,
  orderId: bigint,
  code: RejectReasonCode,
  extra: string | null,
  card?: CardRef,
): Promise<boolean> {
  const reason = REJECT_REASONS[code];
  const shortfall = code === "short" && extra ? Number(extra) : null;
  const customerText = fill(reason.text, {
    farq: shortfall ? formatSum(shortfall) : "",
    matn: code === "other" ? (extra ?? "") : "",
  });
  const stored = code === "short" ? `${reason.label} (${formatSum(shortfall ?? 0)})` : code === "other" ? `${reason.label}: ${extra}` : reason.label;

  const ok = await rejectOrder(orderId, admin.id, stored, shortfall);
  if (!ok) {
    await syncCards(api, orderId, card);
    return false;
  }
  await audit(admin.id, "reject", "order", orderId, { status: "receipt_sent" }, { status: "rejected", reason: stored });
  await syncCards(api, orderId, card);

  const order = (await getOrderFull(orderId))!;
  await trackEvent(order.userId, "rejected", { orderId: orderId.toString(), reason: code });
  const settings = await getSettings();
  const kb = new InlineKeyboard();
  if (reason.resend && order.attempts < settings.max_receipt_attempts) kb.text(await t("btn_resend"), "resend").row();
  const contact = contactAdminKeyboard().inline_keyboard[0][0];
  kb.add(contact);

  const sent = await sendToUser(api, order.user.telegramId, await t("rejected", {}, { sabab: customerText }), { reply_markup: kb });
  if (!sent) await sendToAdminGroup(api, `⚠️ Buyurtma #${orderId}: mijoz (${escapeHtml(displayName(order.user))}) botni bloklagan.`);
  return true;
}
