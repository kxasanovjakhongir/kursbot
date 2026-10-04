import { Router } from "express";
import type { OrderStatus, Prisma } from "@prisma/client";
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

const STATUSES = ["new", "receipt_sent", "rejected", "approved", "joined", "expired", "cancelled", "refunded"] as const satisfies readonly OrderStatus[];

const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

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

  r.get("/", async (req, res) => {
    const { status, page, pageSize } = parseQuery(pagination.extend({ status: z.enum(STATUSES).optional() }), req);
    const where: Prisma.OrderWhereInput = status ? { status } : {};
    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
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
