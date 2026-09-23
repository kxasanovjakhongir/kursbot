import type { Card, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { maskCard } from "../lib/format";

/** Navbat bilan (round-robin): eng uzoq vaqt ishlatilmagan faol karta (TZ 3.3) */
export async function pickCard(tx: Prisma.TransactionClient = prisma): Promise<Card | null> {
  const card = await tx.card.findFirst({
    where: { isActive: true, isDeleted: false },
    orderBy: [{ lastUsedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
  });
  if (!card) return null;
  await tx.card.update({ where: { id: card.id }, data: { lastUsedAt: new Date() } });
  return card;
}

export async function addCard(number: string, holder: string, bank?: string): Promise<Card> {
  const digits = number.replace(/\D/g, "");
  if (digits.length !== 16) throw new Error("Karta raqami 16 ta raqamdan iborat bo'lishi kerak");
  return prisma.card.create({
    data: { number: digits, numberMasked: maskCard(digits), holder, bank: bank ?? null },
  });
}

export async function listCards(): Promise<Card[]> {
  return prisma.card.findMany({ where: { isDeleted: false }, orderBy: { id: "asc" } });
}

/** Karta o'chirilsa ham eski buyurtmalardagi yozuv saqlanadi — shuning uchun soft delete */
export async function deleteCard(id: number): Promise<void> {
  await prisma.card.update({ where: { id }, data: { isDeleted: true, isActive: false } });
}

export async function setCardActive(id: number, isActive: boolean): Promise<void> {
  await prisma.card.update({ where: { id }, data: { isActive } });
}
