import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { maskCard } from "../../lib/format";
import { logActivity } from "../../services/activity";
import { currentUser } from "../auth";
import { HttpError } from "../errors";
import { clientIp, parseBody, parseId } from "../validate";

/** To'lov kartalari (TZ 3.3). Yangi buyurtmaga faol kartalar navbat bilan beriladi */
export const cardsRouter = Router();

const number = z
  .string()
  .transform((s) => s.replace(/\D/g, ""))
  .refine((s) => s.length === 16, "Karta raqami 16 ta raqamdan iborat bo'lishi kerak");

const createSchema = z.object({
  number,
  holder: z.string().trim().min(2).max(100),
  bank: z.string().trim().max(50).optional(),
  monthlyLimit: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().default(true),
});

cardsRouter.get("/", async (_req, res) => {
  const cards = await prisma.card.findMany({ where: { isDeleted: false }, orderBy: { id: "asc" } });
  const since = new Date(Date.now() - 30 * 86400_000);
  const stats = await prisma.order.groupBy({
    by: ["cardId"],
    where: { status: { in: ["approved", "joined"] }, paidAt: { gte: since } },
    _sum: { amount: true },
    _count: { _all: true },
  });
  res.json({
    items: cards.map((c) => {
      const s = stats.find((x) => x.cardId === c.id);
      return { ...c, revenue30d: s?._sum.amount ?? 0, orders30d: s?._count._all ?? 0 };
    }),
  });
});

cardsRouter.post("/", async (req, res) => {
  const body = parseBody(createSchema, req);
  const card = await prisma.card.create({
    data: { ...body, bank: body.bank || null, numberMasked: maskCard(body.number) },
  });
  await logActivity(currentUser(req).id, "CREATE_CARD", `Karta qo'shildi: ${card.numberMasked} (${card.holder})`, clientIp(req));
  res.status(201).json(card);
});

cardsRouter.put("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const body = parseBody(createSchema.partial(), req);
  const existing = await prisma.card.findFirst({ where: { id, isDeleted: false } });
  if (!existing) throw new HttpError(404, "Karta topilmadi");
  const card = await prisma.card.update({
    where: { id },
    data: {
      ...body,
      bank: body.bank === undefined ? undefined : body.bank || null,
      ...(body.number ? { numberMasked: maskCard(body.number) } : {}),
    },
  });
  await logActivity(currentUser(req).id, "UPDATE_CARD", `Karta yangilandi: ${card.numberMasked} (${Object.keys(body).join(", ")})`, clientIp(req));
  res.json(card);
});

/** Karta o'chirilsa ham eski buyurtmalardagi yozuv saqlanadi — soft delete */
cardsRouter.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const card = await prisma.card.findFirst({ where: { id, isDeleted: false } });
  if (!card) throw new HttpError(404, "Karta topilmadi");
  await prisma.card.update({ where: { id }, data: { isDeleted: true, isActive: false } });
  await logActivity(currentUser(req).id, "DELETE_CARD", `Karta o'chirildi: ${card.numberMasked}`, clientIp(req));
  res.status(204).end();
});
