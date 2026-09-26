import type { Notification, NotificationKind } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../lib/logger";

/** Bildirishnoma tarixini yozadi. Yozilmasa ham asosiy jarayon to'xtamaydi */
export async function recordNotification(userId: bigint, kind: NotificationKind, text: string, delivered: boolean): Promise<void> {
  try {
    await prisma.notification.create({ data: { userId, kind, text, delivered } });
  } catch (err) {
    logger.warn({ err, userId: userId.toString(), kind }, "bildirishnoma yozilmadi");
  }
}

export async function listNotifications(
  userId: bigint,
  page: number,
  pageSize: number,
): Promise<{ items: Notification[]; total: number }> {
  const where = { userId };
  const [items, total] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.notification.count({ where }),
  ]);
  return { items, total };
}
