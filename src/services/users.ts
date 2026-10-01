import type { OrderStatus, Prisma, User } from "@prisma/client";
import { prisma } from "../db";
import { DEFAULT_LANG, isLang, type Lang } from "../i18n";
import { PAID_STATUSES } from "./orders";
import { getSettings } from "./settings";
import { escapeLike } from "../lib/format";

export interface TgProfile {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
  language_code?: string;
  is_bot?: boolean;
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
      languageCode: from.language_code ?? null,
      isBot: from.is_bot ?? false,
    },
    update: {
      username: from.username ?? null,
      firstName: from.first_name,
      lastName: from.last_name ?? null,
      languageCode: from.language_code ?? null,
      lastSeenAt: new Date(),
      isBlocked: false,
    },
  });
}

/** lastSeenAt shu oraliqdan tez-tez yozilmaydi — har bir update da bazaga yozish shart emas */
const TOUCH_INTERVAL_MS = 5 * 60_000;

function profileOf(from: TgProfile) {
  return {
    username: from.username ?? null,
    firstName: from.first_name,
    lastName: from.last_name ?? null,
    languageCode: from.language_code ?? null,
  };
}

/**
 * Har bir update uchun: foydalanuvchini topadi yoki yaratadi. Profil o'zgarmagan bo'lsa va
 * yaqinda ko'rilgan bo'lsa bazaga yozmaydi (faqat bitta indeksli o'qish).
 */
export async function touchUser(from: TgProfile): Promise<{ user: User; isNew: boolean }> {
  const telegramId = BigInt(from.id);
  const profile = profileOf(from);
  const existing = await prisma.user.findUnique({ where: { telegramId } });
  if (!existing) {
    const user = await prisma.user.upsert({
      where: { telegramId },
      create: { telegramId, ...profile, isBot: from.is_bot ?? false },
      update: { ...profile, lastSeenAt: new Date(), isBlocked: false },
    });
    return { user, isNew: true };
  }
  const stale = Date.now() - existing.lastSeenAt.getTime() > TOUCH_INTERVAL_MS;
  const changed =
    existing.username !== profile.username ||
    existing.firstName !== profile.firstName ||
    existing.lastName !== profile.lastName ||
    existing.languageCode !== profile.languageCode;
  if (!stale && !changed && !existing.isBlocked) return { user: existing, isNew: false };
  const user = await prisma.user.update({
    where: { id: existing.id },
    data: { ...profile, lastSeenAt: new Date(), isBlocked: false },
  });
  return { user, isNew: false };
}

/** Foydalanuvchi tili: o'zi tanlagani, bo'lmasa bot sozlamalaridagi standart til */
export async function userLang(user: Pick<User, "language"> | null | undefined): Promise<Lang> {
  if (isLang(user?.language)) return user.language;
  const { default_language } = await getSettings();
  return isLang(default_language) ? default_language : DEFAULT_LANG;
}

export async function setLanguage(userId: bigint, language: Lang): Promise<User> {
  return prisma.user.update({ where: { id: userId }, data: { language } });
}

export async function setNewsEnabled(userId: bigint, newsEnabled: boolean): Promise<User> {
  return prisma.user.update({ where: { id: userId }, data: { newsEnabled } });
}

/** Admin tomonidan cheklash / cheklovni olib tashlash */
export async function setBanned(userId: bigint, banned: boolean): Promise<User> {
  return prisma.user.update({ where: { id: userId }, data: { isBanned: banned, bannedAt: banned ? new Date() : null } });
}

export interface UserStats {
  products: number;
  orders: number;
  totalPaid: number;
}

export async function userStats(userId: bigint): Promise<UserStats> {
  const [products, orders, paid] = await Promise.all([
    prisma.accessGrant.count({ where: { userId, revokedAt: null } }),
    prisma.order.count({ where: { userId } }),
    prisma.order.aggregate({ _sum: { amount: true }, where: { userId, status: { in: PAID_STATUSES } } }),
  ]);
  return { products, orders, totalPaid: paid._sum.amount ?? 0 };
}

/** START: birinchi manba saqlanadi (first-touch), oxirgisi esa har safar yangilanadi */
export async function recordStart(user: User, productCode: string | null, source: string): Promise<User> {
  const data = {
    lastProduct: productCode ?? user.lastProduct,
    lastSource: source,
    firstSource: user.firstSource ?? source,
    firstProduct: user.firstProduct ?? productCode,
  };
  // Takroriy /start (hech narsa o'zgarmagan) — bazaga yozilmaydi
  const same = (Object.keys(data) as (keyof typeof data)[]).every((k) => user[k] === data[k]);
  return same ? user : prisma.user.update({ where: { id: user.id }, data });
}

/** Telefon = ro'yxatdan o'tish. Birinchi marta ulashgan vaqt saqlanadi (raqam yangilansa o'zgarmaydi) */
export async function setPhone(userId: bigint, phone: string, isForeign: boolean): Promise<User> {
  const [, user] = await prisma.$transaction([
    prisma.user.updateMany({ where: { id: userId, registeredAt: null }, data: { registeredAt: new Date() } }),
    prisma.user.update({ where: { id: userId }, data: { phone, isForeign } }),
  ]);
  return user;
}

/** Qiymat o'zgarmagan bo'lsa yozilmaydi (mahsulotni qayta ko'rish — ortiqcha UPDATE yo'q) */
export async function setLastProduct(user: Pick<User, "id" | "lastProduct">, code: string): Promise<void> {
  if (user.lastProduct === code) return;
  await prisma.user.update({ where: { id: user.id }, data: { lastProduct: code } });
  user.lastProduct = code;
}

export async function markBlocked(telegramId: bigint): Promise<void> {
  await prisma.user.updateMany({ where: { telegramId }, data: { isBlocked: true } });
}

export function displayName(u: Pick<User, "firstName" | "lastName">): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || "Foydalanuvchi";
}

export type UserStatusFilter = "all" | "active" | "blocked" | "banned";

export interface UserSearch {
  q?: string;
  status: UserStatusFilter;
  page: number;
  pageSize: number;
  /** Marketing filtrlari (admin panel) */
  productId?: number;
  source?: string;
  campaign?: string;
  purchased?: boolean;
  registered?: boolean;
  from?: Date;
  to?: Date;
  /** Shu kursni sotib olganlar (to'langan buyurtma) */
  boughtProductId?: number;
  /** Shu holatdagi buyurtmasi borlar (to'lov holati) */
  paymentStatus?: OrderStatus;
}

export type UserFilter = Omit<UserSearch, "page" | "pageSize">;

/** Ro'yxat (admin panel) va export uchun yagona filtr */
export async function buildUserWhere({ q, status, productId, source, campaign, purchased, registered, from, to, boughtProductId, paymentStatus }: UserFilter): Promise<Prisma.UserWhereInput> {
  const where: Prisma.UserWhereInput = { isBot: false };
  const and: Prisma.UserWhereInput[] = [];
  // Kurs: shu kurs linki orqali kelgan yoki oxirgi ko'rgan kursi shu
  if (productId) {
    const product = await prisma.product.findUnique({ where: { id: productId }, select: { code: true } });
    and.push({ OR: [{ linkVisits: { some: { link: { productId } } } }, ...(product ? [{ lastProduct: product.code }] : [])] });
  }
  // Manba va kampaniya — birinchi kelgan manba (first-touch)
  if (source) and.push({ firstSource: { equals: source, mode: "insensitive" } });
  if (campaign) and.push({ firstLink: { campaign } });
  if (purchased !== undefined) {
    const paid = { some: { status: { in: PAID_STATUSES } } };
    and.push(purchased ? { orders: paid } : { NOT: { orders: paid } });
  }
  if (boughtProductId) and.push({ orders: { some: { productId: boughtProductId, status: { in: PAID_STATUSES } } } });
  if (paymentStatus) and.push({ orders: { some: { status: paymentStatus } } });
  if (registered !== undefined) and.push({ phone: registered ? { not: null } : null });
  if (from || to) and.push({ createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } });
  if (and.length) where.AND = and;
  if (status === "active") where.isBlocked = false;
  if (status === "blocked") where.isBlocked = true;
  if (status === "banned") where.isBanned = true;
  if (q) {
    const term = q.replace(/^@/, "");
    where.OR = [
      ...(/^\d{1,18}$/.test(term) ? [{ telegramId: BigInt(term) }] : []),
      { username: { contains: escapeLike(term), mode: "insensitive" } },
      { firstName: { contains: escapeLike(term), mode: "insensitive" } },
      { lastName: { contains: escapeLike(term), mode: "insensitive" } },
      { phone: { contains: escapeLike(term) } },
    ];
  }
  return where;
}

/** Foydalanuvchilarni qidirish (admin panel): ID, username, ism, telefon bo'yicha */
export async function searchUsers({ page, pageSize, ...filter }: UserSearch) {
  const where = await buildUserWhere(filter);
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      // id — bir xil vaqtli yozuvlar uchun barqaror tartib (sahifalashda takrorlanish/tushib qolish yo'q)
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        telegramId: true,
        username: true,
        firstName: true,
        lastName: true,
        languageCode: true,
        language: true,
        phone: true,
        isBlocked: true,
        isBanned: true,
        firstSource: true,
        lastProduct: true,
        registeredAt: true,
        createdAt: true,
        lastSeenAt: true,
        firstLink: { select: { code: true, source: true, campaign: true, product: { select: { title: true } } } },
      },
    }),
    prisma.user.count({ where }),
  ]);
  // Sahifadagi foydalanuvchilar xaridlari — bitta guruhlangan so'rov (N+1 yo'q)
  const purchases = items.length
    ? await prisma.order.groupBy({
        by: ["userId"],
        where: { userId: { in: items.map((u) => u.id) }, status: { in: PAID_STATUSES } },
        _sum: { amount: true },
        _count: { _all: true },
        _max: { paidAt: true },
      })
    : [];
  const byUser = new Map(purchases.map((p) => [p.userId, p]));
  // Oxirgi ko'rilgan mahsulot kodi → nomi (sahifadagi kodlar bo'yicha bitta so'rov)
  const codes = [...new Set(items.map((u) => u.lastProduct).filter((c): c is string => !!c))];
  const titles = new Map(
    codes.length ? (await prisma.product.findMany({ where: { code: { in: codes } }, select: { code: true, title: true } })).map((p) => [p.code, p.title]) : [],
  );
  return {
    items: items.map((u) => {
      const p = byUser.get(u.id);
      return {
        ...u,
        lastProductTitle: u.lastProduct ? (titles.get(u.lastProduct) ?? null) : null,
        purchase: p ? { count: p._count._all, amount: p._sum.amount ?? 0, lastAt: p._max.paidAt } : null,
      };
    }),
    total,
  };
}
