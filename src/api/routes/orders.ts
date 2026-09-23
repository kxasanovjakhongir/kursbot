import { Router } from "express";
import type { OrderStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db";
import { HttpError } from "../errors";
import type { BotRuntime } from "../runtime";
import { paged, pagination, parseBigId, parseQuery } from "../validate";

const STATUSES = ["new", "receipt_sent", "rejected", "approved", "joined", "expired", "cancelled", "refunded"] as const satisfies readonly OrderStatus[];

/** Savdo buyurtmalari (faqat ko'rish; tasdiqlash Telegram admin guruhida) */
export function ordersRouter(rt: BotRuntime): Router {
  const r = Router();

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
