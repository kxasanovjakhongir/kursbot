import { prisma } from "../db";
import { startOfTashkentDay } from "../lib/format";
import { PAID_STATUSES } from "./orders";

export interface DashboardStats {
  users: {
    total: number;
    /** Faol = botni bloklamagan */
    active: number;
    blocked: number;
    banned: number;
    active30d: number;
    newToday: number;
    newWeek: number;
    newMonth: number;
  };
  messagesToday: number;
  broadcastsSent: number;
  sales: { pendingReceipts: number; ordersToday: number; revenueToday: number; revenueMonth: number };
}

interface UserCounts {
  total: bigint;
  blocked: bigint;
  banned: bigint;
  active30d: bigint;
  new_today: bigint;
  new_week: bigint;
  new_month: bigint;
}

interface SalesCounts {
  pending: bigint;
  orders_today: bigint;
  revenue_today: bigint | null;
  revenue_month: bigint | null;
}

/**
 * Admin panel dashboardi va botdagi admin statistikasi uchun umumiy hisob.
 * Har bir jadval bo'yicha bitta so'rov (COUNT ... FILTER): 13 ta alohida so'rov o'rniga 4 ta —
 * ulanishlar puli band qilinmaydi, jadval bir marta o'qiladi.
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  const today = startOfTashkentDay();
  const week = new Date(today.getTime() - 6 * 86400_000);
  const month = new Date(today.getTime() - 29 * 86400_000);
  const activeSince = new Date(Date.now() - 30 * 86400_000);
  const paid = [...PAID_STATUSES];

  const [[u], [s], messagesToday, broadcastsSent] = await Promise.all([
    prisma.$queryRaw<UserCounts[]>`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE is_blocked) AS blocked,
             count(*) FILTER (WHERE is_banned) AS banned,
             count(*) FILTER (WHERE NOT is_blocked AND last_seen_at >= ${activeSince}) AS active30d,
             count(*) FILTER (WHERE created_at >= ${today}) AS new_today,
             count(*) FILTER (WHERE created_at >= ${week}) AS new_week,
             count(*) FILTER (WHERE created_at >= ${month}) AS new_month
      FROM users WHERE NOT is_bot`,
    prisma.$queryRaw<SalesCounts[]>`
      SELECT count(*) FILTER (WHERE status = 'receipt_sent') AS pending,
             count(*) FILTER (WHERE created_at >= ${today}) AS orders_today,
             sum(amount) FILTER (WHERE status::text = ANY(${paid}) AND paid_at >= ${today}) AS revenue_today,
             sum(amount) FILTER (WHERE status::text = ANY(${paid}) AND paid_at >= ${month}) AS revenue_month
      FROM orders`,
    prisma.message.count({ where: { createdAt: { gte: today } } }),
    prisma.broadcast.count({ where: { status: "completed" } }),
  ]);
  const total = Number(u.total);
  const blocked = Number(u.blocked);

  return {
    users: {
      total,
      active: total - blocked,
      blocked,
      banned: Number(u.banned),
      active30d: Number(u.active30d),
      newToday: Number(u.new_today),
      newWeek: Number(u.new_week),
      newMonth: Number(u.new_month),
    },
    messagesToday,
    broadcastsSent,
    sales: {
      pendingReceipts: Number(s.pending),
      ordersToday: Number(s.orders_today),
      revenueToday: Number(s.revenue_today ?? 0),
      revenueMonth: Number(s.revenue_month ?? 0),
    },
  };
}
