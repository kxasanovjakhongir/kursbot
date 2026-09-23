import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db";
import { HttpError } from "../errors";
import { paged, pagination, parseBigId, parseQuery } from "../validate";

export const telegramUsersRouter = Router();

const listQuery = pagination.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "blocked"]).default("all"),
});

telegramUsersRouter.get("/", async (req, res) => {
  const { q, status, page, pageSize } = parseQuery(listQuery, req);
  const where: Prisma.UserWhereInput = { isBot: false };
  if (status === "active") where.isBlocked = false;
  if (status === "blocked") where.isBlocked = true;
  if (q) {
    const term = q.replace(/^@/, "");
    where.OR = [
      ...(/^\d{1,19}$/.test(term) ? [{ telegramId: BigInt(term) }] : []),
      { username: { contains: term, mode: "insensitive" } },
      { firstName: { contains: term, mode: "insensitive" } },
      { lastName: { contains: term, mode: "insensitive" } },
      { phone: { contains: term } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        telegramId: true,
        username: true,
        firstName: true,
        lastName: true,
        languageCode: true,
        phone: true,
        isBlocked: true,
        firstSource: true,
        createdAt: true,
        lastSeenAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);
  res.json(paged(items, total, page, pageSize));
});

telegramUsersRouter.get("/:id", async (req, res) => {
  const id = parseBigId(req.params.id);
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      orders: { include: { product: { select: { title: true, code: true } } }, orderBy: { createdAt: "desc" }, take: 20 },
      grants: { include: { product: { select: { title: true } } }, where: { revokedAt: null } },
      _count: { select: { messages: true } },
    },
  });
  if (!user) throw new HttpError(404, "Foydalanuvchi topilmadi");
  res.json(user);
});

telegramUsersRouter.get("/:id/messages", async (req, res) => {
  const id = parseBigId(req.params.id);
  const { page, pageSize } = parseQuery(pagination, req);
  const where = { userId: id };
  const [items, total] = await Promise.all([
    prisma.message.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.message.count({ where }),
  ]);
  res.json(paged(items, total, page, pageSize));
});
