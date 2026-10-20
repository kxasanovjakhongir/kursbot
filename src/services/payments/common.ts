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

/**
 * To'lov tizimidan kelgan so'rov — panelda tranzaksiya tarixi sifatida ko'rinadi (meta.events).
 * Maxfiy qiymatlar (imzo, kalit) yozilmaydi.
 */
export interface TxEvent {
  /** Payme metodi (CreateTransaction…) yoki Click bosqichi (prepare / complete) */
  method: string;
  /** Biz qaytargan natija: ok yoki xato kodi */
  result: string;
  at: string;
  [key: string]: string | number | boolean | null | Record<string, string> | undefined;
}

export const txEvent = (method: string, result: string, extra: Omit<TxEvent, "method" | "result" | "at"> = {}): TxEvent => ({
  method,
  result,
  at: new Date().toISOString(),
  ...extra,
});

/** meta.events ga atomik qo'shadi (parallel so'rovlar bir-birini o'chirmaydi); tarix 50 ta bilan cheklangan */
export async function appendTxEvent(db: Prisma.TransactionClient, txId: bigint, event: TxEvent): Promise<void> {
  await db.$executeRaw`
    UPDATE payment_transactions
    SET meta = jsonb_set(
      COALESCE(meta, '{}'::jsonb),
      '{events}',
      (SELECT COALESCE(jsonb_agg(t.e ORDER BY t.i), '[]'::jsonb) FROM (
        SELECT x.e, x.i
        FROM jsonb_array_elements(COALESCE(meta->'events', '[]'::jsonb) || jsonb_build_array(${JSON.stringify(event)}::jsonb)) WITH ORDINALITY AS x(e, i)
        ORDER BY x.i
        OFFSET GREATEST(jsonb_array_length(COALESCE(meta->'events', '[]'::jsonb)) + 1 - 50, 0)
      ) t)
    ),
    updated_at = now()
    WHERE id = ${txId}`;
}

/** Unique indekslar (bitta kutilayotgan / bitta to'langan tranzaksiya) poygada ishlaganda */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
