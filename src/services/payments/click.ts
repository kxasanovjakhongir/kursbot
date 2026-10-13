import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "../../db";
import { config } from "../../config";
import { logger } from "../../lib/logger";
import { checkPayable, isUniqueViolation, markOrderPaidOnline, parseOrderId, TX_STATE } from "./common";

/**
 * Click Shop API: https://docs.click.uz/click-api-request/
 * Click ikki bosqichda so'rov yuboradi (application/x-www-form-urlencoded):
 *   Prepare (action=0) — buyurtmani tekshirish va tranzaksiya yaratish;
 *   Complete (action=1) — to'lov natijasi (error < 0 bo'lsa — to'lov o'tmadi).
 * Har bir so'rov MD5 imzo bilan keladi. Summalar so'mda ("1000" yoki "1000.00").
 */

export const CLICK_ERRORS = {
  ok: { error: 0, error_note: "Success" },
  signFailed: { error: -1, error_note: "SIGN CHECK FAILED!" },
  invalidAmount: { error: -2, error_note: "Incorrect parameter amount" },
  actionNotFound: { error: -3, error_note: "Action not found" },
  alreadyPaid: { error: -4, error_note: "Already paid" },
  orderNotFound: { error: -5, error_note: "User does not exist" },
  txNotFound: { error: -6, error_note: "Transaction does not exist" },
  updateFailed: { error: -7, error_note: "Failed to update user" },
  badRequest: { error: -8, error_note: "Error in request from click" },
  txCancelled: { error: -9, error_note: "Transaction cancelled" },
} as const;

type ClickError = (typeof CLICK_ERRORS)[keyof typeof CLICK_ERRORS];

export interface ClickOutcome {
  body: Record<string, unknown>;
  paidOrderId?: bigint;
  duplicatePayment?: boolean;
}

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** Imzo: md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id [+ merchant_prepare_id] + amount + action + sign_time) */
export function clickSign(p: Record<string, unknown>, action: 0 | 1): string {
  return md5(
    str(p.click_trans_id) +
      str(p.service_id) +
      (config.CLICK_SECRET_KEY ?? "") +
      str(p.merchant_trans_id) +
      (action === 1 ? str(p.merchant_prepare_id) : "") +
      str(p.amount) +
      str(p.action) +
      str(p.sign_time),
  );
}

function signOk(p: Record<string, unknown>, action: 0 | 1): boolean {
  const got = Buffer.from(str(p.sign_string).toLowerCase());
  const want = Buffer.from(clickSign(p, action));
  return got.length === want.length && timingSafeEqual(got, want);
}

/** To'lov sahifasi: https://my.click.uz/services/pay?service_id=..&merchant_id=..&amount=..&transaction_param=<buyurtma> */
export function clickCheckoutUrl(orderId: bigint, amountSum: number, opts: { returnUrl?: string } = {}): string {
  const q = new URLSearchParams({
    service_id: config.CLICK_SERVICE_ID ?? "",
    merchant_id: config.CLICK_MERCHANT_ID ?? "",
    amount: String(amountSum),
    transaction_param: orderId.toString(),
  });
  if (opts.returnUrl) q.set("return_url", opts.returnUrl);
  return `https://my.click.uz/services/pay?${q.toString()}`;
}

/** Click summasi buyurtma summasiga teng (tiyin aniqligida) */
function amountMatches(raw: string, expected: number): boolean {
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(raw)) return false;
  return Math.round(Number(raw) * 100) === expected * 100;
}

const REQUIRED = ["click_trans_id", "service_id", "merchant_trans_id", "amount", "action", "sign_time", "sign_string"] as const;

export async function handleClick(body: unknown, expectedAction: 0 | 1): Promise<ClickOutcome> {
  const p = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const echo = { click_trans_id: str(p.click_trans_id) || null, merchant_trans_id: str(p.merchant_trans_id) || null };
  const reply = (e: ClickError, extra: Record<string, unknown> = {}): ClickOutcome => ({ body: { ...echo, ...extra, ...e } });

  try {
    if (REQUIRED.some((k) => !str(p[k])) || (expectedAction === 1 && !str(p.merchant_prepare_id))) return reply(CLICK_ERRORS.badRequest);
    if (!signOk(p, expectedAction)) return reply(CLICK_ERRORS.signFailed);
    if (str(p.action) !== String(expectedAction)) return reply(CLICK_ERRORS.actionNotFound);
    if (str(p.service_id) !== config.CLICK_SERVICE_ID) return reply(CLICK_ERRORS.badRequest);
    return expectedAction === 0 ? await prepare(p, reply) : await complete(p, reply);
  } catch (err) {
    logger.error({ err, action: expectedAction }, "Click so'rovi xato bilan tugadi");
    return reply(CLICK_ERRORS.updateFailed);
  }
}

type Reply = (e: ClickError, extra?: Record<string, unknown>) => ClickOutcome;

async function prepare(p: Record<string, unknown>, reply: Reply): Promise<ClickOutcome> {
  const clickTransId = str(p.click_trans_id);
  const res = await checkPayable(parseOrderId(p.merchant_trans_id));

  // Click so'rovni takrorlasa — o'sha tranzaksiya
  const existing = await prisma.paymentTransaction.findUnique({ where: { provider_externalId: { provider: "click", externalId: clickTransId } } });
  if (existing) {
    if (existing.state === TX_STATE.paid) return reply(CLICK_ERRORS.alreadyPaid);
    if (existing.state !== TX_STATE.pending) return reply(CLICK_ERRORS.txCancelled);
    return reply(CLICK_ERRORS.ok, { merchant_prepare_id: Number(existing.id) });
  }

  if (!res.ok) return reply(res.reason === "paid" ? CLICK_ERRORS.alreadyPaid : CLICK_ERRORS.orderNotFound);
  const order = res.order;
  if (!amountMatches(str(p.amount), order.amount)) return reply(CLICK_ERRORS.invalidAmount);

  // Oldingi tugallanmagan urinishlar (Click qayta urinish yoki Payme'da tashlab ketilgan) bekor qilinadi:
  // ular endi to'lanmaydi (Payme Perform / Click Complete -31008 / -9 oladi)
  await prisma.paymentTransaction.updateMany({
    where: { orderId: order.id, state: TX_STATE.pending },
    data: { state: TX_STATE.cancelled, cancelledAt: new Date() },
  });

  try {
    const tx = await prisma.paymentTransaction.create({
      data: {
        provider: "click",
        externalId: clickTransId,
        orderId: order.id,
        amount: order.amount,
        meta: { click_paydoc_id: str(p.click_paydoc_id) || null },
      },
    });
    return reply(CLICK_ERRORS.ok, { merchant_prepare_id: Number(tx.id) });
  } catch (err) {
    if (isUniqueViolation(err)) return reply(CLICK_ERRORS.updateFailed);
    throw err;
  }
}

async function complete(p: Record<string, unknown>, reply: Reply): Promise<ClickOutcome> {
  const prepareId = parseOrderId(p.merchant_prepare_id);
  const tx = prepareId
    ? await prisma.paymentTransaction.findFirst({ where: { id: prepareId, provider: "click", externalId: str(p.click_trans_id) } })
    : null;
  if (!tx || tx.orderId.toString() !== str(p.merchant_trans_id)) return reply(CLICK_ERRORS.txNotFound);
  const ids = { merchant_confirm_id: Number(tx.id) };

  if (tx.state === TX_STATE.paid) return reply(CLICK_ERRORS.alreadyPaid, ids);
  if (tx.state !== TX_STATE.pending) return reply(CLICK_ERRORS.txCancelled, ids);
  if (!amountMatches(str(p.amount), tx.amount)) return reply(CLICK_ERRORS.invalidAmount, ids);

  // Click to'lov o'tmaganini bildirdi (masalan, kartada mablag' yetarli emas)
  const clickError = Number(str(p.error) || "0");
  if (clickError < 0) {
    await prisma.paymentTransaction.updateMany({
      where: { id: tx.id, state: TX_STATE.pending },
      data: { state: TX_STATE.cancelled, reason: clickError, cancelledAt: new Date() },
    });
    return reply(CLICK_ERRORS.txCancelled, ids);
  }

  const result = await prisma.$transaction(async (db) => {
    const moved = await db.paymentTransaction.updateMany({
      where: { id: tx.id, state: TX_STATE.pending },
      data: { state: TX_STATE.paid, performedAt: new Date() },
    });
    if (moved.count !== 1) return null;
    return { approved: await markOrderPaidOnline(db, tx.orderId, "click") };
  });
  if (!result) {
    const fresh = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    return reply(fresh.state === TX_STATE.paid ? CLICK_ERRORS.alreadyPaid : CLICK_ERRORS.txCancelled, ids);
  }
  return { ...reply(CLICK_ERRORS.ok, ids), paidOrderId: tx.orderId, duplicatePayment: !result.approved };
}
