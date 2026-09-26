import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db";
import { paged, pagination, parseQuery } from "../validate";
import { escapeLike } from "../../lib/format";

export const messagesRouter = Router();

const query = pagination.extend({
  direction: z.enum(["all", "incoming", "outgoing"]).default("all"),
  q: z.string().trim().max(100).optional(),
});

/** Barcha foydalanuvchilar bilan yozishmalar (eng yangisi birinchi) */
messagesRouter.get("/", async (req, res) => {
  const { direction, q, page, pageSize } = parseQuery(query, req);
  const where: Prisma.MessageWhereInput = {};
  if (direction !== "all") where.direction = direction;
  if (q) where.text = { contains: escapeLike(q), mode: "insensitive" };
  const [items, total] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { id: true, firstName: true, lastName: true, username: true } } },
    }),
    prisma.message.count({ where }),
  ]);
  res.json(paged(items, total, page, pageSize));
});
