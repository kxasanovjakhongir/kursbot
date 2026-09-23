import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db";
import { ACTIONS } from "../../services/activity";
import { paged, pagination, parseQuery } from "../validate";

export const activityRouter = Router();

const query = pagination.extend({
  action: z.enum(ACTIONS).optional(),
  userId: z.coerce.number().int().positive().optional(),
});

activityRouter.get("/", async (req, res) => {
  const { action, userId, page, pageSize } = parseQuery(query, req);
  const where: Prisma.ActivityLogWhereInput = {};
  if (action) where.action = action;
  if (userId) where.panelUserId = userId;
  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { panelUser: { select: { id: true, name: true, email: true } } },
    }),
    prisma.activityLog.count({ where }),
  ]);
  res.json({ ...paged(items, total, page, pageSize), actions: ACTIONS });
});
