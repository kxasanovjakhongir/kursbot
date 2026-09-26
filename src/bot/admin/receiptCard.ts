import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { escapeHtml, formatPhone, formatShortDateTime, formatSum, stripHtml, truncate } from "../../lib/format";
import { displayName } from "../../services/users";
import { getOrderFull } from "../../services/orders";
import { getSettings } from "../../services/settings";
import { reviewKeyboard } from "../keyboards";
import { prisma } from "../../db";

/** Telegram media izohi chegarasi (rasm/hujjat caption) */
export const CAPTION_LIMIT = 1024;
/** Admin yozgan erkin matn (rad etish/bekor qilish sababi) kartochkada shu uzunlikkacha */
const REASON_MAX = 200;

const STATUS_LABEL: Record<string, string> = {
  new: "to'lov kutilmoqda",
  expired: "muddati o'tgan",
  cancelled: "bekor qilingan",
  refunded: "bekor qilingan (to'langan edi)",
};

/**
 * Izoh 1024 belgidan oshsa Telegram xabarni umuman yubormaydi — chek adminlarga yetmay qolardi.
 * Oshsa, avval ikkinchi darajali qatorlar (manba, sanalar, urinish) olib tashlanadi; baribir
 * oshsa — matn qisqartiriladi (teglar yopilmay qolmasligi uchun oddiy matn sifatida).
 */
const OPTIONAL_PREFIXES = ["Manba:", "Buyurtma ochilgan:", "Urinish:"];

export function fitCaption(lines: string[]): string {
  const fits = (ls: string[]) => stripHtml(ls.join("\n")).length <= CAPTION_LIMIT;
  if (fits(lines)) return lines.join("\n");
  let out = [...lines];
  for (const prefix of OPTIONAL_PREFIXES) {
    out = out.filter((l) => !l.startsWith(prefix));
    if (fits(out)) return out.join("\n");
  }
  return escapeHtml(truncate(stripHtml(out.join("\n")), CAPTION_LIMIT));
}

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
    warn.push(`🟡 Qayta urinish (oldingi sabab: ${escapeHtml(truncate(order.rejectReason ?? "—", REASON_MAX))})`);
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
    lines.push("", `❌ <b>Rad etildi</b>: ${escapeHtml(truncate(order.rejectReason ?? "", REASON_MAX))} — ${reviewer}, ${order.reviewedAt ? formatShortDateTime(order.reviewedAt) : ""}`);
  } else if (order.status !== "receipt_sent") {
    const cancelled = order.cancelledAt
      ? ` — ${escapeHtml(order.cancelledBy?.name ?? "admin")} (panel), ${formatShortDateTime(order.cancelledAt)}${order.cancelReason ? `\nSabab: ${escapeHtml(truncate(order.cancelReason, REASON_MAX))}` : ""}`
      : "";
    lines.push("", `ℹ️ Holat: <b>${STATUS_LABEL[order.status] ?? order.status}</b>${cancelled}`);
  }
  return fitCaption(lines);
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
