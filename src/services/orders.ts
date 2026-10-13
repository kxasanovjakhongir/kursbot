import { Prisma, type Order, type OrderStatus, type Product, type Receipt, type ReceiptFileType } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../lib/logger";
import { pickCard } from "./cards";
import { getSettings } from "./settings";
import { onlinePaymentsEnabled } from "../config";

/** Ruxsat etilgan o'tishlar (TZ 8.1). Boshqa har qanday o'zgarish xato. */
export const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ["receipt_sent", "expired", "cancelled"],
  // cancelled — admin paneldan bekor qilish
  receipt_sent: ["approved", "rejected", "cancelled"],
  rejected: ["receipt_sent", "expired", "cancelled"],
  approved: ["joined", "refunded"],
  joined: ["refunded"],
  expired: [],
  cancelled: [],
  refunded: [],
};

/** "Ochiq" buyurtma statuslari (BR-01) */
export const OPEN_STATUSES: OrderStatus[] = ["new", "receipt_sent", "rejected"];

/** To'lovi tasdiqlangan statuslar (tushum hisobi) */
export const PAID_STATUSES: OrderStatus[] = ["approved", "joined"];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class TransitionError extends Error {}

/**
 * Atomik status o'zgarishi: UPDATE ... WHERE id = ? AND status IN (from) (TZ 11.2, BR-12).
 * Qaytaradi: true — o'zgardi, false — buyurtma allaqachon boshqa holatda.
 */
export async function transition(
  orderId: bigint,
  from: OrderStatus[],
  to: OrderStatus,
  data: Prisma.OrderUncheckedUpdateManyInput = {},
  tx: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  for (const f of from) {
    if (!canTransition(f, to)) {
      logger.error({ orderId: orderId.toString(), from: f, to }, "ruxsat etilmagan status o'tishi");
      throw new TransitionError(`${f} -> ${to} o'tishi ruxsat etilmagan`);
    }
  }
  const res = await tx.order.updateMany({
    where: { id: orderId, status: { in: from } },
    data: { ...data, status: to },
  });
  return res.count === 1;
}

/** Muddati o'tgan ochiq buyurtmalarni expired qiladi (BR-02). 2-bosqichda BullMQ vazifasi ham chaqiradi. */
export async function expireStaleOrders(userId?: bigint): Promise<number> {
  const res = await prisma.order.updateMany({
    where: { status: { in: ["new", "rejected"] }, expiresAt: { lt: new Date() }, ...(userId ? { userId } : {}) },
    data: { status: "expired" },
  });
  return res.count;
}

export async function findOpenOrder(userId: bigint, productId: number): Promise<Order | null> {
  return prisma.order.findFirst({ where: { userId, productId, status: { in: OPEN_STATUSES } } });
}

export async function listOpenOrders(userId: bigint) {
  return prisma.order.findMany({
    where: { userId, status: { in: OPEN_STATUSES } },
    include: { product: true },
    orderBy: { createdAt: "desc" },
  });
}

export type CreateOrderResult =
  | { kind: "created"; order: Order }
  | { kind: "existing"; order: Order }
  | { kind: "no_card" }
  | { kind: "no_price" };

/** Link orqali kelgan buyurtma shu muddat ichida linkka bog'lanadi (oxirgi bosilgan link — last-click) */
export const ATTRIBUTION_DAYS = 30;

/** Buyurtma qaysi kampaniya linkidan kelgan: foydalanuvchining oxirgi linki ATTRIBUTION_DAYS ichida bo'lsa */
async function attributedLinkId(tx: Prisma.TransactionClient, userId: bigint): Promise<number | null> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { lastLinkId: true, lastLinkAt: true } });
  if (!user?.lastLinkId || !user.lastLinkAt) return null;
  return Date.now() - user.lastLinkAt.getTime() <= ATTRIBUTION_DAYS * 86400_000 ? user.lastLinkId : null;
}

/**
 * "Darslikni olaman": yangi buyurtma, narx qotiriladi, karta tanlanadi, muddat 72 soat (TZ 5.4).
 * Faol karta bo'lmasa — faqat Payme / Click sozlangan bo'lsa yaratiladi (cardId = null).
 * Shu mahsulotga ochiq buyurtma bo'lsa — o'sha qaytariladi (BR-01).
 */
export async function createOrder(userId: bigint, product: Product, source: string | null): Promise<CreateOrderResult> {
  await expireStaleOrders(userId);
  const existing = await findOpenOrder(userId, product.id);
  if (existing) return { kind: "existing", order: existing };
  if (product.price <= 0) return { kind: "no_price" };

  const settings = await getSettings();
  try {
    return await prisma.$transaction(async (tx) => {
      const card = await pickCard(tx);
      // Karta yo'q, lekin Payme / Click yoqilgan — buyurtma faqat onlayn to'lov bilan
      if (!card && !onlinePaymentsEnabled()) return { kind: "no_card" } as const;
      const order = await tx.order.create({
        data: {
          userId,
          productId: product.id,
          amount: Math.round(product.price),
          cardId: card?.id ?? null,
          source,
          linkId: await attributedLinkId(tx, userId),
          expiresAt: new Date(Date.now() + settings.order_ttl_hours * 3600_000),
        },
      });
      return { kind: "created", order } as const;
    });
  } catch (err) {
    // Ikki marta tez bosilganda qisman unique indeks (orders_one_open) ishlaydi
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const order = await findOpenOrder(userId, product.id);
      if (order) return { kind: "existing", order };
    }
    throw err;
  }
}

export interface IncomingReceipt {
  fileId: string;
  fileUniqueId: string;
  fileType: ReceiptFileType;
}

export type AttachReceiptResult =
  | { kind: "ok"; receipt: Receipt; order: Order; isDuplicate: boolean; previous: Receipt | null }
  | { kind: "max_attempts"; order: Order }
  | { kind: "under_review"; order: Order }
  | { kind: "closed"; order: Order | null };

/** Chekni buyurtmaga biriktiradi: new/rejected -> receipt_sent, urinishlar +1 (TZ 5.5, BR-04) */
export async function attachReceipt(orderId: bigint, file: IncomingReceipt): Promise<AttachReceiptResult> {
  const settings = await getSettings();
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) return { kind: "closed", order: null };
    if (order.status === "receipt_sent") return { kind: "under_review", order };
    if (order.status !== "new" && order.status !== "rejected") return { kind: "closed", order };
    if (order.expiresAt < new Date()) return { kind: "closed", order };
    if (order.attempts >= settings.max_receipt_attempts) return { kind: "max_attempts", order };

    const dup = await tx.receipt.findFirst({
      where: { fileUniqueId: file.fileUniqueId, orderId: { not: orderId } },
      select: { id: true },
    });
    const previous = await tx.receipt.findFirst({ where: { orderId }, orderBy: { id: "desc" } });

    const ok = await transition(orderId, ["new", "rejected"], "receipt_sent", { attempts: { increment: 1 } }, tx);
    if (!ok) return { kind: "closed", order };

    const receipt = await tx.receipt.create({
      data: { orderId, fileId: file.fileId, fileUniqueId: file.fileUniqueId, fileType: file.fileType, isDuplicate: !!dup },
    });
    const updated = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    return { kind: "ok", receipt, order: updated, isDuplicate: !!dup, previous };
  });
}

export async function setReceiptAdminMessage(receiptId: bigint, chatId: bigint, messageId: number): Promise<void> {
  await prisma.receipt.update({
    where: { id: receiptId },
    data: { adminChatId: chatId, adminMessageId: BigInt(messageId) },
  });
}

/** Kim ko'rib chiqdi: Telegram admini yoki admin panel foydalanuvchisi */
export interface ReviewerRef {
  adminId?: number | null;
  panelUserId?: number | null;
}

/** Admin tasdiqlashi — faqat receipt_sent holatidagi buyurtma (BR-12) */
export async function approveOrder(orderId: bigint, reviewer: ReviewerRef): Promise<boolean> {
  const now = new Date();
  return transition(orderId, ["receipt_sent"], "approved", {
    reviewedById: reviewer.adminId ?? null,
    reviewedByPanelId: reviewer.panelUserId ?? null,
    reviewedAt: now,
    paidAt: now,
    rejectReason: null,
  });
}

export async function rejectOrder(
  orderId: bigint,
  reviewer: ReviewerRef,
  reason: string,
  shortfall: number | null,
): Promise<boolean> {
  return transition(orderId, ["receipt_sent"], "rejected", {
    reviewedById: reviewer.adminId ?? null,
    reviewedByPanelId: reviewer.panelUserId ?? null,
    reviewedAt: new Date(),
    rejectReason: reason,
    shortfall,
  });
}

/** Mijoz o'zi bekor qiladi — faqat chek yuborilmagan (new) o'z buyurtmasini */
export async function cancelOrder(userId: bigint, orderId: bigint): Promise<boolean> {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, select: { id: true } });
  if (!order) return false;
  return transition(orderId, ["new"], "cancelled");
}

export async function markJoined(orderId: bigint): Promise<boolean> {
  return transition(orderId, ["approved"], "joined");
}

export async function getOrderFull(orderId: bigint) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: true,
      product: true,
      card: true,
      promo: true,
      reviewedBy: true,
      reviewedByPanel: { select: { name: true } },
      cancelledBy: { select: { name: true } },
    },
  });
}

export async function pendingReceiptOrders(limit = 20) {
  return prisma.order.findMany({
    where: { status: "receipt_sent" },
    include: { user: true, product: true, receipts: { orderBy: { id: "desc" }, take: 1 } },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
}
