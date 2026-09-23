import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { escapeHtml, formatPhone, formatShortDateTime, formatSum } from "../../lib/format";
import { displayName } from "../../services/users";
import { getOrderFull } from "../../services/orders";
import { getSettings } from "../../services/settings";
import { reviewKeyboard } from "../keyboards";
import { prisma } from "../../db";

export interface CardFlags {
  isDuplicate?: boolean;
}

/** Admin guruhidagi chek xabari matni (TZ 7.2). Admin qo'shimcha narsa ochmasdan qaror qila olishi kerak. */
export async function buildReceiptCaption(orderId: bigint, flags: CardFlags = {}): Promise<string> {
  const order = await getOrderFull(orderId);
  if (!order) return `Buyurtma #${orderId} topilmadi`;
  const settings = await getSettings();
  const lastReceipt = await prisma.receipt.findFirst({ where: { orderId }, orderBy: { id: "desc" } });
  const isDuplicate = flags.isDuplicate ?? lastReceipt?.isDuplicate ?? false;

  const warn: string[] = [];
  if (isDuplicate) warn.push("🔴 <b>DUBLIKAT</b> — bu fayl boshqa buyurtmada ishlatilgan");
  if (order.shortfall && order.attempts > 1) {
    warn.push(`🟠 <b>Qisman to'lov</b> — oldingi chekda ${formatSum(order.shortfall)} kam edi`);
  } else if (order.attempts > 1) {
    warn.push(`🟡 Qayta urinish (oldingi sabab: ${escapeHtml(order.rejectReason ?? "—")})`);
  }

  const u = order.user;
  const client = [escapeHtml(displayName(u)), u.username ? `@${escapeHtml(u.username)}` : null, formatPhone(u.phone)]
    .filter(Boolean)
    .join(", ");
  const card = order.card ? `${order.card.numberMasked} (${escapeHtml(order.card.holder)})` : "—";
  const promo = order.promo ? ` (promo: ${escapeHtml(order.promo.code)})` : "";
  const source = [u.firstSource, order.source].filter(Boolean);

  const lines = [
    ...warn,
    ...(warn.length ? [""] : []),
    `<b>Yangi chek — buyurtma #${order.id}</b>`,
    `Mahsulot: ${escapeHtml(order.product.title)}`,
    `Summa: <b>${formatSum(order.amount)}</b>${promo}`,
    `Karta: ${card}`,
    `Mijoz: ${client}${u.isForeign ? " 🌍 xorijiy" : ""}`,
    `Manba: ${escapeHtml(source.length ? [...new Set(source)].join(" / ") : "direct")}`,
    `Buyurtma ochilgan: ${formatShortDateTime(order.createdAt)}${lastReceipt ? ` · Chek: ${formatShortDateTime(lastReceipt.createdAt)}` : ""}`,
    `Urinish: ${order.attempts} / ${settings.max_receipt_attempts}`,
  ];

  const reviewer = escapeHtml(order.reviewedByPanel ? `${order.reviewedByPanel.name} (panel)` : (order.reviewedBy?.name ?? "admin"));
  if (order.status === "approved" || order.status === "joined") {
    lines.push("", `✅ <b>Tasdiqlandi</b>: ${reviewer}, ${order.reviewedAt ? formatShortDateTime(order.reviewedAt) : ""}`);
  } else if (order.status === "rejected") {
    lines.push("", `❌ <b>Rad etildi</b>: ${escapeHtml(order.rejectReason ?? "")} — ${reviewer}, ${order.reviewedAt ? formatShortDateTime(order.reviewedAt) : ""}`);
  } else if (order.status !== "receipt_sent") {
    lines.push("", `ℹ️ Holat: ${order.status}`);
  }
  return lines.join("\n");
}

/** Chek rasmi + kartochka + tugmalarni yuboradi (rasm caption bilan birga) */
export async function postReceiptCard(api: Api, chatId: number | bigint, orderId: bigint, replyTo?: number) {
  const receipt = await prisma.receipt.findFirst({ where: { orderId }, orderBy: { id: "desc" } });
  const caption = await buildReceiptCaption(orderId);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  const reply_markup = order?.status === "receipt_sent" ? reviewKeyboard(orderId) : new InlineKeyboard();
  const opts = {
    caption,
    parse_mode: "HTML" as const,
    reply_markup,
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
  };
  const chat = Number(chatId);
  if (!receipt) return api.sendMessage(chat, caption, { parse_mode: "HTML", reply_markup });
  return receipt.fileType === "photo" ? api.sendPhoto(chat, receipt.fileId, opts) : api.sendDocument(chat, receipt.fileId, opts);
}
