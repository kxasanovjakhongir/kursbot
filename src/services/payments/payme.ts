import { timingSafeEqual } from "node:crypto";
import type { PaymentTransaction } from "@prisma/client";
import { prisma } from "../../db";
import { config } from "../../config";
import { logger } from "../../lib/logger";
import { checkPayable, isUniqueViolation, markOrderPaidOnline, parseOrderId, TX_STATE, type PayableResult } from "./common";

/**
 * Payme Merchant API (JSON-RPC 2.0): https://developer.help.paycom.uz/metody-merchant-api/
 * Payme bizning serverga so'rov yuboradi; javob har doim HTTP 200, xato — `error` maydonida.
 * Summalar tiyinda (1 so'm = 100 tiyin), vaqtlar — millisekundlarda.
 */

/** Yaratilgan, lekin to'lanmagan tranzaksiya shuncha vaqtdan keyin bekor qilinadi (Payme talabi: 12 soat) */
export const PAYME_TX_TIMEOUT_MS = 12 * 3600_000;

/** Bekor qilish sababi: vaqt tugadi (Payme spetsifikatsiyasi, reason = 4) */
const REASON_TIMEOUT = 4;

type Lang = { uz: string; ru: string; en: string };
const msg = (uz: string, ru: string, en: string): Lang => ({ uz, ru, en });

export const PAYME_ERRORS = {
  invalidAuth: { code: -32504, message: msg("Avtorizatsiya xatosi", "Недостаточно привилегий", "Insufficient privileges") },
  parse: { code: -32700, message: msg("JSON xato", "Ошибка парсинга JSON", "Parse error") },
  invalidRequest: { code: -32600, message: msg("Noto'g'ri so'rov", "Неверный запрос", "Invalid request") },
  methodNotFound: { code: -32601, message: msg("Metod topilmadi", "Метод не найден", "Method not found") },
  system: { code: -32400, message: msg("Tizim xatosi", "Системная ошибка", "System error") },
  invalidAmount: { code: -31001, message: msg("Summa noto'g'ri", "Неверная сумма", "Invalid amount") },
  txNotFound: { code: -31003, message: msg("Tranzaksiya topilmadi", "Транзакция не найдена", "Transaction not found") },
  cannotCancel: { code: -31007, message: msg("Buyurtma bajarilgan, bekor qilib bo'lmaydi", "Заказ выполнен, отмена невозможна", "Order completed, cannot cancel") },
  cannotPerform: { code: -31008, message: msg("Amalni bajarib bo'lmaydi", "Невозможно выполнить операцию", "Unable to perform operation") },
  // -31050 … -31099: hisob (buyurtma) xatolari
  orderNotFound: { code: -31050, message: msg("Buyurtma topilmadi", "Заказ не найден", "Order not found") },
  orderPaid: { code: -31051, message: msg("Buyurtma allaqachon to'langan", "Заказ уже оплачен", "Order already paid") },
  orderClosed: { code: -31052, message: msg("Buyurtma yopilgan yoki muddati o'tgan", "Заказ закрыт или истёк", "Order closed or expired") },
  orderBusy: { code: -31053, message: msg("Buyurtma bo'yicha to'lov kutilmoqda", "Заказ ожидает оплаты", "Order is awaiting payment") },
  orderUnderReview: { code: -31054, message: msg("Buyurtma cheki tekshirilmoqda", "Чек заказа на проверке", "Order receipt is under review") },
} as const;

type PaymeError = { code: number; message: Lang; data?: string };

export interface PaymeRequest {
  id?: unknown;
  method?: unknown;
  params?: Record<string, unknown>;
}

/** Javob va bajarilishi kerak bo'lgan qo'shimcha amallar (bot xabarlari — javob qaytgandan keyin) */
export interface PaymeOutcome {
  body: { jsonrpc: "2.0"; id: unknown; result?: unknown; error?: PaymeError };
  paidOrderId?: bigint;
  /** To'lov o'tdi, lekin buyurtma allaqachon to'langan edi (ikki marta to'lov) */
  duplicatePayment?: boolean;
  refundedOrderId?: bigint;
}

class PaymeFault extends Error {
  constructor(public readonly error: PaymeError) {
    super(error.message.en);
  }
}

const fail = (e: { code: number; message: Lang }, data?: string): never => {
  throw new PaymeFault({ code: e.code, message: e.message, ...(data ? { data } : {}) });
};

/** Authorization: Basic base64("Paycom:<kalit>") */
export function checkPaymeAuth(header: string | undefined): boolean {
  const key = config.PAYME_KEY;
  if (!key || !header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  const got = Buffer.from(decoded.slice(sep + 1));
  const want = Buffer.from(key);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Checkout havolasi: https://checkout.paycom.uz/<base64(m=..;ac.order_id=..;a=..;c=..)> */
export function paymeCheckoutUrl(orderId: bigint, amountSum: number, opts: { returnUrl?: string; lang?: string } = {}): string {
  const parts = [`m=${config.PAYME_MERCHANT_ID}`, `ac.${config.PAYME_ACCOUNT_FIELD}=${orderId}`, `a=${amountSum * 100}`];
  if (opts.lang && ["uz", "ru", "en"].includes(opts.lang)) parts.push(`l=${opts.lang}`);
  // ";" — parametrlar ajratgichi, shuning uchun qaytish manzilida bo'lmasligi kerak
  if (opts.returnUrl && !opts.returnUrl.includes(";")) parts.push(`c=${opts.returnUrl}`);
  const host = config.PAYME_TEST_MODE ? "https://checkout.test.paycom.uz" : "https://checkout.paycom.uz";
  return `${host}/${Buffer.from(parts.join(";")).toString("base64")}`;
}

const ms = (d: Date | null | undefined): number => (d ? d.getTime() : 0);

function txView(tx: PaymentTransaction) {
  return {
    create_time: ms(tx.createdAt),
    perform_time: ms(tx.performedAt),
    cancel_time: ms(tx.cancelledAt),
    transaction: tx.id.toString(),
    state: tx.state,
    reason: tx.reason,
  };
}

function accountOrderId(params: Record<string, unknown>): bigint | null {
  const account = params.account;
  if (!account || typeof account !== "object") return null;
  return parseOrderId((account as Record<string, unknown>)[config.PAYME_ACCOUNT_FIELD]);
}

function requireString(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v !== "string" || v.length === 0 || v.length > 64) fail(PAYME_ERRORS.invalidRequest, key);
  return v as string;
}

function requireNumber(params: Record<string, unknown>, key: string, err: { code: number; message: Lang } = PAYME_ERRORS.invalidRequest): number {
  const v = params[key];
  if (typeof v !== "number" || !Number.isFinite(v)) fail(err, key);
  return v as number;
}

function payableOrFail(res: PayableResult) {
  if (res.ok) return res.order;
  switch (res.reason) {
    case "not_found":
      return fail(PAYME_ERRORS.orderNotFound, config.PAYME_ACCOUNT_FIELD);
    case "paid":
      return fail(PAYME_ERRORS.orderPaid, config.PAYME_ACCOUNT_FIELD);
    case "under_review":
      return fail(PAYME_ERRORS.orderUnderReview, config.PAYME_ACCOUNT_FIELD);
    default:
      return fail(PAYME_ERRORS.orderClosed, config.PAYME_ACCOUNT_FIELD);
  }
}

/** Fiskal chek ma'lumoti (PAYME_IKPU sozlangan bo'lsa) */
async function receiptDetail(orderId: bigint, amountTiyin: number) {
  if (!config.PAYME_IKPU || !config.PAYME_PACKAGE_CODE) return undefined;
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { product: { select: { title: true } } } });
  return {
    receipt_type: 0,
    items: [
      {
        title: (order?.product.title ?? `Buyurtma #${orderId}`).slice(0, 128),
        price: amountTiyin,
        count: 1,
        code: config.PAYME_IKPU,
        package_code: config.PAYME_PACKAGE_CODE,
        vat_percent: config.PAYME_VAT_PERCENT,
      },
    ],
  };
}

async function checkPerform(params: Record<string, unknown>) {
  const amount = requireNumber(params, "amount", PAYME_ERRORS.invalidAmount);
  const orderId = accountOrderId(params);
  const order = payableOrFail(await checkPayable(orderId));
  if (amount !== order.amount * 100) fail(PAYME_ERRORS.invalidAmount);
  const detail = await receiptDetail(order.id, amount);
  return { allow: true, ...(detail ? { detail } : {}) };
}

/** Vaqti o'tgan kutilayotgan tranzaksiyani bekor qiladi; true — bekor qilindi */
async function expireIfStale(tx: PaymentTransaction): Promise<boolean> {
  if (tx.state !== TX_STATE.pending || Date.now() - tx.createdAt.getTime() <= PAYME_TX_TIMEOUT_MS) return false;
  await prisma.paymentTransaction.updateMany({
    where: { id: tx.id, state: TX_STATE.pending },
    data: { state: TX_STATE.cancelled, reason: REASON_TIMEOUT, cancelledAt: new Date() },
  });
  return true;
}

async function createTransaction(params: Record<string, unknown>) {
  const externalId = requireString(params, "id");
  const time = requireNumber(params, "time");
  const amount = requireNumber(params, "amount", PAYME_ERRORS.invalidAmount);

  const existing = await prisma.paymentTransaction.findUnique({ where: { provider_externalId: { provider: "payme", externalId } } });
  if (existing) {
    if (existing.state !== TX_STATE.pending) fail(PAYME_ERRORS.cannotPerform);
    if (await expireIfStale(existing)) fail(PAYME_ERRORS.cannotPerform);
    return { create_time: ms(existing.createdAt), transaction: existing.id.toString(), state: existing.state };
  }

  const orderId = accountOrderId(params);
  const order = payableOrFail(await checkPayable(orderId));
  if (amount !== order.amount * 100) fail(PAYME_ERRORS.invalidAmount);

  // Shu buyurtma bo'yicha boshqa kutilayotgan tranzaksiya
  const pending = await prisma.paymentTransaction.findFirst({ where: { orderId: order.id, state: TX_STATE.pending } });
  if (pending) {
    if (pending.provider === "payme" && !(await expireIfStale(pending))) fail(PAYME_ERRORS.orderBusy, config.PAYME_ACCOUNT_FIELD);
    // Boshqa tizimdagi (Click) tugallanmagan urinish — mijoz Payme'ni tanladi, eskisi bekor qilinadi
    if (pending.provider !== "payme") {
      await prisma.paymentTransaction.updateMany({
        where: { id: pending.id, state: TX_STATE.pending },
        data: { state: TX_STATE.cancelled, cancelledAt: new Date() },
      });
    }
  }

  try {
    const tx = await prisma.paymentTransaction.create({
      data: { provider: "payme", externalId, orderId: order.id, amount: order.amount, providerTime: BigInt(Math.trunc(time)) },
    });
    return { create_time: ms(tx.createdAt), transaction: tx.id.toString(), state: tx.state };
  } catch (err) {
    // Parallel so'rov: shu id bilan yaratilgan yoki buyurtmaga boshqa tranzaksiya ulgurib qo'shilgan
    if (isUniqueViolation(err)) {
      const same = await prisma.paymentTransaction.findUnique({ where: { provider_externalId: { provider: "payme", externalId } } });
      if (same?.state === TX_STATE.pending) return { create_time: ms(same.createdAt), transaction: same.id.toString(), state: same.state };
      fail(PAYME_ERRORS.orderBusy, config.PAYME_ACCOUNT_FIELD);
    }
    throw err;
  }
}

async function findTx(params: Record<string, unknown>): Promise<PaymentTransaction> {
  const externalId = requireString(params, "id");
  const tx = await prisma.paymentTransaction.findUnique({ where: { provider_externalId: { provider: "payme", externalId } } });
  if (!tx) fail(PAYME_ERRORS.txNotFound);
  return tx!;
}

async function performTransaction(params: Record<string, unknown>, out: PaymeOutcome) {
  const tx = await findTx(params);
  if (tx.state === TX_STATE.paid) return { transaction: tx.id.toString(), perform_time: ms(tx.performedAt), state: tx.state };
  if (tx.state !== TX_STATE.pending) fail(PAYME_ERRORS.cannotPerform);
  if (await expireIfStale(tx)) fail(PAYME_ERRORS.cannotPerform);

  const result = await prisma.$transaction(async (db) => {
    const now = new Date();
    const moved = await db.paymentTransaction.updateMany({
      where: { id: tx.id, state: TX_STATE.pending },
      data: { state: TX_STATE.paid, performedAt: now },
    });
    if (moved.count !== 1) return null; // parallel so'rov ulgurdi
    const approved = await markOrderPaidOnline(db, tx.orderId, "payme");
    return { performedAt: now, approved };
  });

  if (!result) {
    const fresh = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    if (fresh.state !== TX_STATE.paid) fail(PAYME_ERRORS.cannotPerform);
    return { transaction: fresh.id.toString(), perform_time: ms(fresh.performedAt), state: fresh.state };
  }
  out.paidOrderId = tx.orderId;
  out.duplicatePayment = !result.approved;
  return { transaction: tx.id.toString(), perform_time: result.performedAt.getTime(), state: TX_STATE.paid };
}

async function cancelTransaction(params: Record<string, unknown>, out: PaymeOutcome) {
  const tx = await findTx(params);
  const reason = typeof params.reason === "number" ? Math.trunc(params.reason) : null;
  if (tx.state === TX_STATE.cancelled || tx.state === TX_STATE.refunded) {
    return { transaction: tx.id.toString(), cancel_time: ms(tx.cancelledAt), state: tx.state };
  }
  const now = new Date();
  const to = tx.state === TX_STATE.paid ? TX_STATE.refunded : TX_STATE.cancelled;
  const moved = await prisma.paymentTransaction.updateMany({
    where: { id: tx.id, state: tx.state },
    data: { state: to, reason, cancelledAt: now },
  });
  if (moved.count !== 1) {
    // Parallel o'zgardi — joriy holatni qaytaramiz
    const fresh = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    if (fresh.state === TX_STATE.cancelled || fresh.state === TX_STATE.refunded) {
      return { transaction: fresh.id.toString(), cancel_time: ms(fresh.cancelledAt), state: fresh.state };
    }
    fail(PAYME_ERRORS.cannotPerform);
  }
  // To'langan tranzaksiya bekor qilindi — pul mijozga qaytariladi, kirish olib tashlanadi
  if (to === TX_STATE.refunded) out.refundedOrderId = tx.orderId;
  return { transaction: tx.id.toString(), cancel_time: now.getTime(), state: to };
}

async function checkTransaction(params: Record<string, unknown>) {
  return txView(await findTx(params));
}

async function getStatement(params: Record<string, unknown>) {
  const from = requireNumber(params, "from");
  const to = requireNumber(params, "to");
  const txs = await prisma.paymentTransaction.findMany({
    where: { provider: "payme", providerTime: { gte: BigInt(Math.trunc(from)), lte: BigInt(Math.trunc(to)) } },
    orderBy: { providerTime: "asc" },
  });
  return {
    transactions: txs.map((tx) => ({
      id: tx.externalId,
      time: Number(tx.providerTime ?? 0n),
      amount: tx.amount * 100,
      account: { [config.PAYME_ACCOUNT_FIELD]: tx.orderId.toString() },
      ...txView(tx),
    })),
  };
}

/** Bitta Payme so'rovini qayta ishlaydi. Auth tekshiruvi ham shu yerda (Payme xato formatida javob kutadi) */
export async function handlePayme(body: unknown, authHeader: string | undefined): Promise<PaymeOutcome> {
  const req = (body && typeof body === "object" ? body : {}) as PaymeRequest;
  const out: PaymeOutcome = { body: { jsonrpc: "2.0", id: req.id ?? null } };
  try {
    if (!checkPaymeAuth(authHeader)) fail(PAYME_ERRORS.invalidAuth);
    if (typeof req.method !== "string" || !req.params || typeof req.params !== "object") fail(PAYME_ERRORS.invalidRequest);
    const params = req.params!;
    switch (req.method) {
      case "CheckPerformTransaction":
        out.body.result = await checkPerform(params);
        break;
      case "CreateTransaction":
        out.body.result = await createTransaction(params);
        break;
      case "PerformTransaction":
        out.body.result = await performTransaction(params, out);
        break;
      case "CancelTransaction":
        out.body.result = await cancelTransaction(params, out);
        break;
      case "CheckTransaction":
        out.body.result = await checkTransaction(params);
        break;
      case "GetStatement":
        out.body.result = await getStatement(params);
        break;
      default:
        // ChangePassword ham: kalit .env da saqlanadi, Payme orqali almashtirilmaydi
        fail(PAYME_ERRORS.methodNotFound, String(req.method));
    }
  } catch (err) {
    if (err instanceof PaymeFault) {
      out.body.error = err.error;
    } else {
      logger.error({ err, method: req.method }, "Payme so'rovi xato bilan tugadi");
      out.body.error = { code: PAYME_ERRORS.system.code, message: PAYME_ERRORS.system.message };
    }
    delete out.paidOrderId;
    delete out.refundedOrderId;
  }
  return out;
}
