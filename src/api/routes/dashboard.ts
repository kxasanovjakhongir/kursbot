import { Router } from "express";
import { prisma } from "../../db";
import { startOfTashkentDay } from "../../lib/format";

export const dashboardRouter = Router();

dashboardRouter.get("/stats", async (_req, res) => {
  const today = startOfTashkentDay();
  const week = new Date(today.getTime() - 6 * 86400_000);
  const month = new Date(today.getTime() - 29 * 86400_000);
  const activeSince = new Date(Date.now() - 30 * 86400_000);
  const users = { isBot: false };

  const [total, blocked, active30d, newToday, newWeek, newMonth, messagesToday, broadcastsSent, pendingReceipts, ordersToday, revenueToday, revenueMonth] =
    await Promise.all([
      prisma.user.count({ where: users }),
      prisma.user.count({ where: { ...users, isBlocked: true } }),
      prisma.user.count({ where: { ...users, isBlocked: false, lastSeenAt: { gte: activeSince } } }),
      prisma.user.count({ where: { ...users, createdAt: { gte: today } } }),
      prisma.user.count({ where: { ...users, createdAt: { gte: week } } }),
      prisma.user.count({ where: { ...users, createdAt: { gte: month } } }),
      prisma.message.count({ where: { createdAt: { gte: today } } }),
      prisma.broadcast.count({ where: { status: "completed" } }),
      prisma.order.count({ where: { status: "receipt_sent" } }),
      prisma.order.count({ where: { createdAt: { gte: today } } }),
      prisma.order.aggregate({ _sum: { amount: true }, where: { status: { in: ["approved", "joined"] }, paidAt: { gte: today } } }),
      prisma.order.aggregate({ _sum: { amount: true }, where: { status: { in: ["approved", "joined"] }, paidAt: { gte: month } } }),
    ]);

  res.json({
    users: {
      total,
      // Faol = botni bloklamagan
      active: total - blocked,
      blocked,
      active30d,
      newToday,
      newWeek,
      newMonth,
    },
    messagesToday,
    broadcastsSent,
    sales: {
      pendingReceipts,
      ordersToday,
      revenueToday: revenueToday._sum.amount ?? 0,
      revenueMonth: revenueMonth._sum.amount ?? 0,
    },
  });
});
