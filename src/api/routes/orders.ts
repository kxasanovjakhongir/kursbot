import { Router } from "express";
import type { OrderStatus, PaymentMethod, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db";
import { approveAndNotify, cancelAndNotify, rejectAndNotify } from "../../bot/admin/reviewActions";
import { logActivity } from "../../services/activity";
import { parseRejectInput, rejectReasonList, rejectSchema } from "../rejectInput";
import { currentUser } from "../auth";
import { HttpError } from "../errors";
import { sendTelegramFile } from "../telegramFile";
import type { BotRuntime } from "../runtime";
import { clientIp, paged, pagination, parseBigId, parseBody, parseQuery } from "../validate";
import { escapeLike } from "../../lib/format";

const METHODS = ["card", "payme", "click"] as const satisfies readonly PaymentMethod[];
const STATUSES = ["new", "receipt_sent", "rejected", "approved", "joined", "expired", "cancelled", "refunded"] as const satisfies readonly OrderStatus[];

const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

const TX_STATES = ["1", "2", "-1", "-2"] as const;
const paymentsQuery = pagination.extend({
  provider: z.enum(["payme", "click"]).optional(),
  state: z.enum(TX_STATES).optional(),
  q: z.string().trim().max(100).optional(),
});

const historyQuery = pagination.extend({
  result: z.enum(["all", "approved", "rejected", "cancelled"]).default("all"),
  q: z.string().trim().max(100).optional(),
});

/** Savdo buyurtmalari va cheklarni tasdiqlash (Telegram admin guruhi bilan bir xil mantiq) */
export function ordersRouter(rt: BotRuntime): Router {
  const r = Router();

  /** Panel sidebar'idagi belgi va yangi chek bildirishnomasi uchun */
  r.get("/pending-count", async (_req, res) => {
    const [count, latest] = await Promise.all([
      prisma.order.count({ where: { status: "receipt_sent" } }),
      prisma.receipt.findFirst({ where: { order: { status: "receipt_sent" } }, orderBy: { id: "desc" }, select: { id: true } }),
    ]);
    res.json({ count, latestReceiptId: latest?.id ?? null });
  });

  r.get("/reject-reasons", (_req, res) => {
    res.json({ items: rejectReasonList() });
  });

  r.post("/:id/approve", async (req, res) => {
    const id = parseBigId(req.params.id);
    const me = currentUser(req);
    const ok = await approveAndNotify(rt.api, id, { panelUserId: me.id });
    if (!ok) throw new HttpError(409, "Bu chek allaqachon ko'rib chiqilgan");
    await logActivity(me.id, "APPROVE_ORDER", `Buyurtma #${id} tasdiqlandi`, clientIp(req));
    res.json({ ok: true });
  });

  r.post("/:id/reject", async (req, res) => {
    const id = parseBigId(req.params.id);
    const me = currentUser(req);
    const { code, extra } = parseRejectInput(parseBody(rejectSchema, req));
    const result = await rejectAndNotify(rt.api, id, code, extra, { panelUserId: me.id });
    if (!result.ok) throw new HttpError(409, "Bu chek allaqachon ko'rib chiqilgan");
    await logActivity(me.id, "REJECT_ORDER", `Buyurtma #${id} rad etildi: ${result.stored}`, clientIp(req));
    res.json({ ok: true });
  });

  r.post("/:id/cancel", async (req, res) => {
    const id = parseBigId(req.params.id);
    const me = currentUser(req);
    const { reason } = parseBody(cancelSchema, req);
    const result = await cancelAndNotify(rt.api, id, { panelUserId: me.id }, reason || null);
    if (!result.ok) {
      if (result.reason === "not_found") throw new HttpError(404, "Buyurtma topilmadi");
      if (result.reason === "kick_failed") {
        throw new HttpError(409, `Bot «${result.product}» kanalida admin emas yoki «a'zolarni bloklash» huquqi yo'q — mijozni kanaldan chiqarib bo'lmadi, buyurtma bekor qilinmadi`);
      }
      throw new HttpError(409, "Bu buyurtmani bekor qilib bo'lmaydi (allaqachon yopilgan)");
    }
    const what = result.status === "refunded" ? `bekor qilindi (to'langan, kanaldan chiqarildi: ${result.revoked})` : "bekor qilindi";
    await logActivity(me.id, "CANCEL_ORDER", `Buyurtma #${id} ${what}${reason ? `: ${reason}` : ""}`, clientIp(req));
    res.json(result);
  });

  /**
   * Cheklar tarixi — ko'rib chiqilgan (tasdiqlangan / rad etilgan / bekor qilingan) cheklar.
   * Har bir buyurtma bitta qator (qayta yuborilgan cheklar soni bilan), oxirgi ko'rib chiqilgani birinchi.
   */
  r.get("/receipts/history", async (req, res) => {
    const { result, q, page, pageSize } = parseQuery(historyQuery, req);
    const where: Prisma.OrderWhereInput = { receipts: { some: {} }, status: { not: "receipt_sent" } };
    if (result === "approved") where.paidAt = { not: null };
    if (result === "rejected") Object.assign(where, { paidAt: null, rejectReason: { not: null }, cancelledAt: null });
    if (result === "cancelled") where.cancelledAt = { not: null };
    if (q) {
      const term = q.replace(/^#/, "");
      const like = { contains: escapeLike(term), mode: "insensitive" as const };
      where.OR = [
        ...(/^\d{1,18}$/.test(term) ? [{ id: BigInt(term) }] : []),
        { user: { OR: [{ firstName: like }, { lastName: like }, { username: like }, { phone: { contains: escapeLike(term.replace(/\D/g, "") || term) } }] } },
        { product: { title: like } },
      ];
    }
    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: [{ reviewedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, username: true, phone: true } },
          product: { select: { title: true, code: true } },
          reviewedBy: { select: { name: true } },
          reviewedByPanel: { select: { name: true } },
          cancelledBy: { select: { name: true } },
          receipts: { select: { id: true, fileType: true, isDuplicate: true, createdAt: true }, orderBy: { id: "desc" } },
        },
      }),
      prisma.order.count({ where }),
    ]);
    res.json(paged(items, total, page, pageSize));
  });

  /**
   * Onlayn to'lovlar (Payme / Click tranzaksiyalari): kim, qaysi kursga, qancha, qaysi holatda.
   * summary — tanlangan tizim va qidiruv bo'yicha holatlar kesimida soni va summasi (holat filtrisiz).
   */
  r.get("/payments", async (req, res) => {
    const { provider, state, q, page, pageSize } = parseQuery(paymentsQuery, req);
    const base: Prisma.PaymentTransactionWhereInput = provider ? { provider } : {};
    if (q) {
      const term = q.replace(/^#/, "");
      const like = { contains: escapeLike(term), mode: "insensitive" as const };
      base.OR = [
        ...(/^\d{1,18}$/.test(term) ? [{ orderId: BigInt(term) }] : []),
        { externalId: term },
        { order: { user: { OR: [{ firstName: like }, { lastName: like }, { username: like }, { phone: { contains: escapeLike(term.replace(/\D/g, "") || term) } }] } } },
        { order: { product: { title: like } } },
      ];
    }
    const where: Prisma.PaymentTransactionWhereInput = state ? { ...base, state: Number(state) } : base;
    const [items, total, groups] = await Promise.all([
      prisma.paymentTransaction.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          provider: true,
          externalId: true,
          state: true,
          reason: true,
          amount: true,
          meta: true,
          createdAt: true,
          performedAt: true,
          cancelledAt: true,
          order: {
            select: {
              id: true,
              status: true,
              paymentMethod: true,
              user: { select: { id: true, firstName: true, lastName: true, username: true, phone: true } },
              product: { select: { title: true } },
            },
          },
        },
      }),
      prisma.paymentTransaction.count({ where }),
      prisma.paymentTransaction.groupBy({ by: ["state"], where: base, _count: { _all: true }, _sum: { amount: true } }),
    ]);
    const summary = Object.fromEntries(
      TX_STATES.map((s) => {
        const g = groups.find((x) => x.state === Number(s));
        return [s, { count: g?._count._all ?? 0, amount: g?._sum.amount ?? 0 }];
      }),
    );
    res.json({ ...paged(items, total, page, pageSize), summary });
  });

  r.get("/", async (req, res) => {
    // paid=1 — faqat to'lov tushgan buyurtmalar (kim, qachon, qaysi usulda to'lagani), oxirgi to'lov birinchi
    const { status, method, paid, page, pageSize } = parseQuery(
      pagination.extend({ status: z.enum(STATUSES).optional(), method: z.enum(METHODS).optional(), paid: z.literal("1").optional() }),
      req,
    );
    const where: Prisma.OrderWhereInput = { ...(status && { status }), ...(method && { paymentMethod: method }), ...(paid && { paidAt: { not: null } }) };
    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: paid ? [{ paidAt: "desc" }, { id: "desc" }] : { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, username: true, phone: true } },
          product: { select: { title: true, code: true } },
          card: { select: { numberMasked: true, holder: true } },
          receipts: { select: { id: true, fileType: true, isDuplicate: true, createdAt: true }, orderBy: { id: "desc" }, take: 1 },
        },
      }),
      prisma.order.count({ where }),
    ]);
    res.json(paged(items, total, page, pageSize));
  });

  r.get("/:id", async (req, res) => {
    const id = parseBigId(req.params.id);
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, username: true, phone: true, telegramId: true } },
        product: { select: { title: true, code: true } },
        card: { select: { numberMasked: true, holder: true } },
        reviewedBy: { select: { name: true } },
        reviewedByPanel: { select: { name: true } },
        cancelledBy: { select: { name: true } },
        receipts: { select: { id: true, fileType: true, isDuplicate: true, createdAt: true }, orderBy: { id: "asc" } },
        transactions: {
          select: { id: true, provider: true, externalId: true, state: true, amount: true, createdAt: true, performedAt: true, cancelledAt: true },
          orderBy: { id: "asc" },
        },
      },
    });
    if (!order) throw new HttpError(404, "Buyurtma topilmadi");
    res.json(order);
  });

  /** Chek faylini Telegram'dan proksi qiladi — bot tokeni brauzerga chiqmaydi */
  r.get("/:id/receipts/:receiptId/file", async (req, res) => {
    const orderId = parseBigId(req.params.id);
    const receiptId = parseBigId(req.params.receiptId);
    const receipt = await prisma.receipt.findFirst({ where: { id: receiptId, orderId } });
    if (!receipt) throw new HttpError(404, "Chek topilmadi");
    await sendTelegramFile(res, rt.api, receipt.fileId, "image/jpeg");
  });

  return r;
}
