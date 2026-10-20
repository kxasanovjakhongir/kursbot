import { once } from "node:events";
import type { Writable } from "node:stream";
import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { cleanText, tashkentWallClock } from "./rows";

/** Onlayn to'lovlar (Payme / Click) Excel eksporti — paneldagi ro'yxatning barcha ustunlari */

export const PAYMENTS_EXPORT_LIMIT = 100_000;
const BATCH = 1000;

const TX_STATE_LABEL: Record<number, string> = { 1: "Kutilmoqda", 2: "To'langan", [-1]: "Bekor qilingan", [-2]: "Pul qaytarilgan" };
const ORDER_STATUS_LABEL: Record<string, string> = {
  new: "Yangi",
  receipt_sent: "Chek tekshirilmoqda",
  rejected: "Rad etilgan",
  approved: "Tasdiqlangan",
  joined: "Kanalga qo'shilgan",
  expired: "Muddati o'tgan",
  cancelled: "Bekor qilingan",
  refunded: "Pul qaytarilgan",
};
const PAYME_REASON: Record<number, string> = {
  1: "Qabul qiluvchi topilmadi yoki faol emas",
  2: "Hisobdan yechishda xato",
  3: "Tranzaksiya bajarilmadi",
  4: "Vaqt tugadi",
  5: "Pul qaytarildi",
  10: "Noma'lum xato",
};

const select = {
  id: true,
  provider: true,
  externalId: true,
  state: true,
  reason: true,
  amount: true,
  providerTime: true,
  meta: true,
  createdAt: true,
  performedAt: true,
  cancelledAt: true,
  order: {
    select: {
      id: true,
      status: true,
      amount: true,
      paymentMethod: true,
      user: { select: { telegramId: true, firstName: true, lastName: true, username: true, phone: true } },
      product: { select: { code: true, title: true } },
    },
  },
} satisfies Prisma.PaymentTransactionSelect;

type Row = Prisma.PaymentTransactionGetPayload<{ select: typeof select }>;

export function reasonLabel(provider: string, reason: number | null): string {
  if (reason === null) return "";
  if (provider === "payme") return PAYME_REASON[reason] ?? `Payme sababi: ${reason}`;
  return `Click xato kodi: ${reason}`;
}

type Kind = "text" | "date" | "money";
const COLUMNS: { header: string; width: number; kind: Kind; value: (r: Row) => string | number | Date | null }[] = [
  { header: "ID", width: 10, kind: "text", value: (r) => r.id.toString() },
  { header: "Tizim", width: 8, kind: "text", value: (r) => (r.provider === "payme" ? "Payme" : "Click") },
  { header: "Tranzaksiya ID (tizimda)", width: 28, kind: "text", value: (r) => r.externalId },
  { header: "Click to'lov hujjati", width: 18, kind: "text", value: (r) => metaString(r.meta, "click_paydoc_id") },
  { header: "Holat", width: 16, kind: "text", value: (r) => TX_STATE_LABEL[r.state] ?? String(r.state) },
  { header: "Sabab / xato", width: 30, kind: "text", value: (r) => reasonLabel(r.provider, r.reason) },
  { header: "Summa (so'm)", width: 14, kind: "money", value: (r) => r.amount },
  { header: "Boshlangan", width: 17, kind: "date", value: (r) => r.createdAt },
  { header: "To'langan", width: 17, kind: "date", value: (r) => r.performedAt },
  { header: "Bekor qilingan / qaytarilgan", width: 17, kind: "date", value: (r) => r.cancelledAt },
  { header: "Payme vaqti", width: 17, kind: "date", value: (r) => (r.providerTime ? new Date(Number(r.providerTime)) : null) },
  { header: "Buyurtma #", width: 11, kind: "text", value: (r) => r.order.id.toString() },
  { header: "Buyurtma holati", width: 18, kind: "text", value: (r) => ORDER_STATUS_LABEL[r.order.status] ?? r.order.status },
  { header: "Buyurtma summasi (so'm)", width: 14, kind: "money", value: (r) => r.order.amount },
  { header: "Kurs", width: 30, kind: "text", value: (r) => r.order.product.title },
  { header: "Kurs kodi", width: 12, kind: "text", value: (r) => r.order.product.code },
  { header: "Mijoz", width: 26, kind: "text", value: (r) => [r.order.user.firstName, r.order.user.lastName].filter(Boolean).join(" ") },
  { header: "Telegram ID", width: 14, kind: "text", value: (r) => r.order.user.telegramId.toString() },
  { header: "Username", width: 18, kind: "text", value: (r) => (r.order.user.username ? `@${r.order.user.username}` : "") },
  { header: "Telefon", width: 16, kind: "text", value: (r) => r.order.user.phone ?? "" },
];

function metaString(meta: Prisma.JsonValue, key: string): string {
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const v = (meta as Record<string, Prisma.JsonValue>)[key];
    if (typeof v === "string" || typeof v === "number") return String(v);
  }
  return "";
}

function cell(v: string | number | Date | null): string | number | Date | null {
  if (v === null || v === "") return null;
  if (v instanceof Date) return tashkentWallClock(v);
  return typeof v === "string" ? cleanText(v) : v;
}

export async function countPayments(where: Prisma.PaymentTransactionWhereInput): Promise<number> {
  return prisma.paymentTransaction.count({ where });
}

/** payments-2026-10-20-1530.xlsx (Toshkent vaqti) */
export function paymentsFileName(at = new Date()): string {
  const t = new Date(at.getTime() + 5 * 3600_000).toISOString();
  return `payments-${t.slice(0, 10)}-${t.slice(11, 13)}${t.slice(14, 16)}.xlsx`;
}

/** Stream rejimidagi Excel: bo'laklab o'qiladi (id bo'yicha kursor), xotirada butun ro'yxat to'planmaydi */
export async function writePaymentsXlsx(where: Prisma.PaymentTransactionWhereInput, out: Writable): Promise<number> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  wb.creator = "Darslik bot";
  wb.created = new Date();
  const ws = wb.addWorksheet("Onlayn to'lovlar", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = COLUMNS.map((c, i) => ({
    header: c.header,
    key: String(i),
    width: c.width,
    style: c.kind === "date" ? { numFmt: "dd.mm.yyyy hh:mm" } : c.kind === "money" ? { numFmt: "#,##0" } : {},
  }));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;
  header.commit();

  let written = 0;
  let cursor: bigint | undefined;
  while (written < PAYMENTS_EXPORT_LIMIT) {
    const rows = await prisma.paymentTransaction.findMany({
      where: cursor ? { AND: [where, { id: { lt: cursor } }] } : where,
      orderBy: { id: "desc" },
      take: Math.min(BATCH, PAYMENTS_EXPORT_LIMIT - written),
      select,
    });
    if (rows.length === 0) break;
    for (const r of rows) ws.addRow(COLUMNS.map((c) => cell(c.value(r)))).commit();
    // Qabul qiluvchi sekin bo'lsa — bufer to'lib ketmasligi uchun kutamiz
    if (out.writableNeedDrain) await once(out, "drain");
    written += rows.length;
    cursor = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }
  ws.commit();
  await wb.commit();
  return written;
}
