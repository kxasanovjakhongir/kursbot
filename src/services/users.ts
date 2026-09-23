import type { User } from "@prisma/client";
import { prisma } from "../db";

export interface TgProfile {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
}

/** Foydalanuvchini yaratadi yoki profilini yangilaydi */
export async function upsertUser(from: TgProfile): Promise<User> {
  return prisma.user.upsert({
    where: { telegramId: BigInt(from.id) },
    create: {
      telegramId: BigInt(from.id),
      username: from.username ?? null,
      firstName: from.first_name,
      lastName: from.last_name ?? null,
    },
    update: {
      username: from.username ?? null,
      firstName: from.first_name,
      lastName: from.last_name ?? null,
      lastSeenAt: new Date(),
      isBlocked: false,
    },
  });
}

/** START: birinchi manba saqlanadi (first-touch), oxirgisi esa har safar yangilanadi */
export async function recordStart(user: User, productCode: string | null, source: string): Promise<User> {
  return prisma.user.update({
    where: { id: user.id },
    data: {
      lastProduct: productCode ?? user.lastProduct,
      lastSource: source,
      firstSource: user.firstSource ?? source,
      firstProduct: user.firstProduct ?? productCode,
    },
  });
}

export async function setPhone(userId: bigint, phone: string, isForeign: boolean): Promise<User> {
  return prisma.user.update({ where: { id: userId }, data: { phone, isForeign } });
}

export async function setLastProduct(userId: bigint, code: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { lastProduct: code } });
}

export async function markBlocked(telegramId: bigint): Promise<void> {
  await prisma.user.updateMany({ where: { telegramId }, data: { isBlocked: true } });
}

export function displayName(u: Pick<User, "firstName" | "lastName">): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || "Foydalanuvchi";
}
