import { Router } from "express";
import type { OrderStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db";
import { approveAndNotify, rejectAndNotify } from "../../bot/admin/reviewActions";
import { logActivity } from "../../services/activity";
import { isRejectReason, REJECT_REASONS } from "../../services/texts";
import { currentUser } from "../auth";
import { HttpError } from "../errors";
import type { BotRuntime } from "../runtime";
import { clientIp, paged, pagination, parseBigId, parseBody, parseQuery } from "../validate";

const STATUSES = ["new", "receipt_sent", "rejected", "approved", "joined", "expired", "cancelled", "refunded"] as const satisfies readonly OrderStatus[];

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
    res.json({ items: Object.entries(REJECT_REASONS).map(([code, v]) => ({ code, label: v.label, needsInput: code === "short" || code === "other" })) });
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
    const body = parseBody(
      z.object({
        reason: z.string().refine(isRejectReason, "Noma'lum sabab"),
        amount: z.number().int().positive().optional(),
        text: z.string().trim().min(1).max(500).optional(),
      }),
      req,
    );
    if (!isRejectReason(body.reason)) throw new HttpError(400, "Noma'lum sabab");
    if (body.reason === "short" && !body.amount) throw new HttpError(400, "Yetishmayotgan summani kiriting");
    if (body.reason === "other" && !body.text) throw new HttpError(400, "Sababni yozing");
    const extra = body.reason === "short" ? String(body.amount) : body.reason === "other" ? (body.text ?? null) : null;
    const result = await rejectAndNotify(rt.api, id, body.reason, extra, { panelUserId: me.id });
    if (!result.ok) throw new HttpError(409, "Bu chek allaqachon ko'rib chiqilgan");
    await logActivity(me.id, "REJECT_ORDER", `Buyurtma #${id} rad etildi: ${result.stored}`, clientIp(req));
    res.json({ ok: true });
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
        receipts: { select: { id: true, fileType: true, isDuplicate: true, createdAt: true }, orderBy: { id: "asc" } },
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
    const file = await rt.api.getFile(receipt.fileId);
    if (!file.file_path) throw new HttpError(404, "Fayl mavjud emas");
    const upstream = await fetch(`https://api.telegram.org/file/bot${rt.api.token}/${file.file_path}`);
    if (!upstream.ok) throw new HttpError(502, "Faylni Telegram'dan olib bo'lmadi");
    // helmet nosniff yoqilgan — turi aniq ko'rsatiladi
    const ext = file.file_path.split(".").pop()?.toLowerCase();
    const type = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(Buffer.from(await upstream.arrayBuffer()));
  });

  return r;
}
