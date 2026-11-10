import type { PaymentMethod } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db";
import { logger } from "../lib/logger";
import { postToCrmStatus, sendLeadToCrm, type SendOptions } from "./crm";
import { TX_STATE } from "./payments/common";

/**
 * To'lov tasdiqlanganda CRM'ga yuboriladigan tranzaksiya (Payme / Click orqali tushgan pul).
 * CRM_PAYMENT_WEBHOOK_URL bo'sh bo'lsa hech narsa qilmaydi. Bot oqimini to'xtatmaydi: xatolar faqat logga yoziladi.
 */
export interface CrmPaymentPayload {
  transaction_id: string;
  /** So'mda */
  amount: number;
  currency: "UZS";
  method: PaymentMethod;
  telegram_id: string;
  phone: string;
  kurs: string;
}

export interface PaymentFacts {
  transactionId: string;
  amount: number;
  method: PaymentMethod;
  telegramId: bigint;
  phone: string | null;
  courseTitle: string;
}

export function buildPaymentPayload(f: PaymentFacts): CrmPaymentPayload {
  return {
    transaction_id: f.transactionId,
    amount: f.amount,
    currency: "UZS",
    method: f.method,
    telegram_id: f.telegramId.toString(),
    phone: f.phone ? (f.phone.startsWith("+") ? f.phone : `+${f.phone}`) : "",
    kurs: f.courseTitle,
  };
}

/** Tranzaksiya raqami: Payme/Click — to'lov tizimining raqami (provider-ID), boshqa usul — buyurtma raqami */
export const crmTransactionId = (method: PaymentMethod, externalId: string | null, orderId: bigint): string =>
  externalId ? `${method}-${externalId}` : `${method}-order-${orderId}`;

const CRM_METHODS: PaymentMethod[] = ["payme", "click"];

export async function sendPaymentToCrm(orderId: bigint, opts: SendOptions & { leadUrl?: string } = {}): Promise<boolean> {
  const url = opts.url ?? config.CRM_PAYMENT_WEBHOOK_URL;
  if (!url) return false;
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        product: true,
        transactions: { where: { state: TX_STATE.paid }, orderBy: { id: "desc" }, take: 1 },
      },
    });
    // CRM faqat onlayn to'lovlarni qabul qiladi (method: payme | click); karta cheki yuborilmaydi
    if (!order || !CRM_METHODS.includes(order.paymentMethod)) return false;
    const payload = buildPaymentPayload({
      transactionId: crmTransactionId(order.paymentMethod, order.transactions[0]?.externalId ?? null, order.id),
      amount: order.amount,
      method: order.paymentMethod,
      telegramId: order.user.telegramId,
      phone: order.user.phone,
      courseTitle: order.product.title,
    });
    const fields = { orderId: orderId.toString(), transactionId: payload.transaction_id };
    const first = await postToCrmStatus(url, payload, "to'lov", fields, opts);
    if (first.ok) return true;
    // CRM to'lovni faqat lid bor bo'lsa qabul qiladi (404). Telefon CRM ulanishidan oldin ulashilgan yoki lid yuborilmagan
    // bo'lishi mumkin: avval lid yuboriladi, keyin to'lov qayta yuboriladi
    if (first.status === 404 && (await sendLeadToCrm(order.user, { url: opts.leadUrl, fetchImpl: opts.fetchImpl, retryDelayMs: opts.retryDelayMs }))) {
      return (await postToCrmStatus(url, payload, "to'lov (lid yuborilgach)", fields, opts)).ok;
    }
    return false;
  } catch (err) {
    logger.error({ err, orderId: orderId.toString() }, "CRM: to'lovni tayyorlashda xato");
    return false;
  }
}
