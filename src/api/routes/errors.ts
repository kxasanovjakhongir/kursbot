import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db";
import { logActivity } from "../../services/activity";
import { currentUser } from "../auth";
import { HttpError } from "../errors";
import { clientIp, paged, pagination, parseBigId, parseQuery } from "../validate";

/** Texnik xatolar (bot, API, fon vazifalari) — lib/errorSink.ts yig'adi */
export const errorsRouter = Router();

const query = pagination.extend({
  status: z.enum(["open", "resolved", "all"]).default("open"),
  q: z.string().trim().max(200).optional(),
});

/** Sidebar belgisi uchun — ochiq (hal qilinmagan) xatolar soni */
errorsRouter.get("/count", async (_req, res) => {
  res.json({ open: await prisma.errorLog.count({ where: { resolvedAt: null } }) });
});

errorsRouter.get("/", async (req, res) => {
  const { status, q, page, pageSize } = parseQuery(query, req);
  const where: Prisma.ErrorLogWhereInput = {};
  if (status === "open") where.resolvedAt = null;
  if (status === "resolved") where.resolvedAt = { not: null };
  if (q) {
    where.OR = [
      { message: { contains: q, mode: "insensitive" } },
      { errorText: { contains: q, mode: "insensitive" } },
      { errorType: { contains: q, mode: "insensitive" } },
    ];
  }
  const [items, total, open, resolved] = await Promise.all([
    prisma.errorLog.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      // Ro'yxatda og'ir maydonlar kerak emas — tafsilot /:id da
      omit: { stack: true, context: true },
    }),
    prisma.errorLog.count({ where }),
    prisma.errorLog.count({ where: { resolvedAt: null } }),
    prisma.errorLog.count({ where: { resolvedAt: { not: null } } }),
  ]);
  res.json({ ...paged(items, total, page, pageSize), counts: { open, resolved } });
});

errorsRouter.get("/:id", async (req, res) => {
  const item = await prisma.errorLog.findUnique({ where: { id: parseBigId(req.params.id) } });
  if (!item) throw new HttpError(404, "Xato topilmadi");
  res.json(item);
});

/** Barcha ochiq xatolarni "hal qilindi" deb belgilash */
errorsRouter.post("/resolve-all", async (req, res) => {
  const { count } = await prisma.errorLog.updateMany({ where: { resolvedAt: null }, data: { resolvedAt: new Date() } });
  await logActivity(currentUser(req).id, "RESOLVE_ERROR", `${count} ta xato hal qilindi deb belgilandi`, clientIp(req));
  res.json({ ok: true, count });
});

/** Hal qilingan xatolarni o'chirish (takrorlansa — yangidan paydo bo'ladi) */
errorsRouter.delete("/resolved", async (req, res) => {
  const { count } = await prisma.errorLog.deleteMany({ where: { resolvedAt: { not: null } } });
  await logActivity(currentUser(req).id, "RESOLVE_ERROR", `${count} ta hal qilingan xato o'chirildi`, clientIp(req));
  res.json({ ok: true, count });
});

errorsRouter.post("/:id/resolve", async (req, res) => {
  const id = parseBigId(req.params.id);
  const item = await prisma.errorLog.update({ where: { id }, data: { resolvedAt: new Date() } }).catch(() => null);
  if (!item) throw new HttpError(404, "Xato topilmadi");
  await logActivity(currentUser(req).id, "RESOLVE_ERROR", `Hal qilindi: ${item.message.slice(0, 120)}`, clientIp(req));
  res.json(item);
});

errorsRouter.post("/:id/reopen", async (req, res) => {
  const id = parseBigId(req.params.id);
  const item = await prisma.errorLog.update({ where: { id }, data: { resolvedAt: null } }).catch(() => null);
  if (!item) throw new HttpError(404, "Xato topilmadi");
  res.json(item);
});
