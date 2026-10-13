import { Prisma, type Order, type OrderStatus, type PaymentMethod } from "@prisma/client";
import { prisma } from "../../db";

/**
 * Payme va Click uchun umumiy qism: buyurtmani to'lovga yaroqliligini tekshirish va
 * to'lov tushganda buyurtmani tasdiqlash (admin tekshiruvisiz).
 */

/** Tranzaksiya holatlari (Payme bilan bir xil raqamlar) */
export const TX_STATE = {
  pending: 1,
  paid: 2,
  cancelled: -1,
  refunded: -2,
} as const;

/** Onlayn to'lov boshlanishi mumkin bo'lgan buyurtma holatlari */
const PAYABLE: OrderStatus[] = ["new", "rejected"];

/**
 * Pul yechib olingach buyurtma qaysi holatlardan tasdiqlanadi. Ataylab TRANSITIONS dan kengroq:
 * to'lov boshlangandan keyin buyurtma muddati o'tib qolsa (expired), mijoz uni bekor qilsa (cancelled)
 * yoki shu orada chek yuborsa (receipt_sent) ham — pul olindi, demak kirish berilishi shart.
 */
const PAID_FROM: OrderStatus[] = ["new", "rejected", "receipt_sent", "expired", "cancelled"];

export type PayableResult =
  | { ok: true; order: Order }
  | { ok: false; reason: "not_found" | "paid" | "under_review" | "expired" | "closed"; order: Order | null };

/** Tashqi tizimdan kelgan buyurtma raqami: faqat musbat butun son */
export function parseOrderId(raw: unknown): bigint | null {
  const s = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^[1-9]\d{0,17}$/.test(s)) return null;
  return BigInt(s);
}

export async function checkPayable(orderId: bigint | null, db: Prisma.TransactionClient = prisma): Promise<PayableResult> {
  if (orderId === null) return { ok: false, reason: "not_found", order: null };
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, reason: "not_found", order: null };
  if (order.status === "approved" || order.status === "joined") return { ok: false, reason: "paid", order };
  if (order.status === "receipt_sent") return { ok: false, reason: "under_review", order };
  if (!PAYABLE.includes(order.status)) return { ok: false, reason: "closed", order };
  if (order.expiresAt < new Date()) return { ok: false, reason: "expired", order };
  return { ok: true, order };
}

/**
 * To'lov tushdi: buyurtma tasdiqlanadi (paidAt, to'lov usuli). Chaqiruvchining DB tranzaksiyasi ichida.
 * false — buyurtma allaqachon to'langan (masalan, admin karta chekini tasdiqlagan) — ikki marta to'lov,
 * pulni qaytarish kerak bo'ladi.
 */
export async function markOrderPaidOnline(db: Prisma.TransactionClient, orderId: bigint, method: PaymentMethod): Promise<boolean> {
  const now = new Date();
  const res = await db.order.updateMany({
    where: { id: orderId, status: { in: PAID_FROM } },
    data: {
      status: "approved",
      paymentMethod: method,
      paidAt: now,
      reviewedAt: now,
      reviewedById: null,
      reviewedByPanelId: null,
      rejectReason: null,
      cancelledAt: null,
      cancelReason: null,
    },
  });
  return res.count === 1;
}

/** To'lov ilovasidan qaytish manzili — bot chati */
export function returnUrl(botUsername: string | undefined): string | undefined {
  return botUsername ? `https://t.me/${botUsername}` : undefined;
}

/** Unique indekslar (bitta kutilayotgan / bitta to'langan tranzaksiya) poygada ishlaganda */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
