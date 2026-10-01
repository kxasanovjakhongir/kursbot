import type { Product } from "@prisma/client";
import { prisma } from "../db";

export async function listActiveProducts(): Promise<Product[]> {
  return prisma.product.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
}

export async function getProductByCode(code: string | null | undefined): Promise<Product | null> {
  if (!code) return null;
  return prisma.product.findUnique({ where: { code } });
}

export async function getActiveProduct(code: string | null | undefined): Promise<Product | null> {
  const p = await getProductByCode(code);
  return p && p.isActive ? p : null;
}

/**
 * Ko'rish mumkin bo'lgan kurs: sotuvdagi yoki — sotuvdan olingan bo'lsa ham — foydalanuvchi uni
 * sotib olgan (darslar va kanal havolasi xaridorda qolishi kerak). Paneldan o'chirilgani — yo'q.
 */
export async function getViewableProduct(code: string | null | undefined, userId: bigint): Promise<Product | null> {
  const p = await getProductByCode(code);
  if (!p || p.deletedAt) return null;
  if (p.isActive) return p;
  return (await checkOwnership(userId, p)).kind === "owned" ? p : null;
}

/** Sotuvdan olingan, lekin foydalanuvchida bor kurslar (katalogda ✅ bilan qoladi) */
export async function ownedInactiveProducts(owned: Set<number>): Promise<Product[]> {
  if (!owned.size) return [];
  return prisma.product.findMany({
    where: { id: { in: [...owned] }, isActive: false, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
}

/** Kanalga kirish beradigan mahsulotlar: oddiy darslik — o'zi, to'plam — tarkibi */
export async function componentProducts(product: Product): Promise<Product[]> {
  if (product.type !== "bundle") return [product];
  const items = await prisma.product.findMany({ where: { code: { in: product.bundleCodes } } });
  return product.bundleCodes.map((c) => items.find((p) => p.code === c)).filter((p): p is Product => !!p);
}

/** Foydalanuvchida faol kirish bor mahsulot IDlari */
export async function ownedProductIds(userId: bigint): Promise<Set<number>> {
  const grants = await prisma.accessGrant.findMany({
    where: { userId, revokedAt: null },
    select: { productId: true },
  });
  return new Set(grants.map((g) => g.productId));
}

export type Ownership =
  | { kind: "none" }
  | { kind: "owned" }
  // To'plam tanlangan, lekin bir qismi allaqachon olingan (TZ 3.2)
  | { kind: "partial"; missing: Product[] };

export async function checkOwnership(userId: bigint, product: Product): Promise<Ownership> {
  const owned = await ownedProductIds(userId);
  const parts = await componentProducts(product);
  const missing = parts.filter((p) => !owned.has(p.id));
  if (missing.length === 0 && parts.length > 0) return { kind: "owned" };
  if (missing.length < parts.length) return { kind: "partial", missing };
  return { kind: "none" };
}

/**
 * Ro'yxat uchun egalik — bitta so'rov bilan (checkOwnership ni har bir mahsulotga chaqirmaslik uchun).
 * To'plam: barcha qismlari bo'lsa "owned", bir qismi bo'lsa "partial".
 */
export async function ownershipMap(userId: bigint, products: Product[]): Promise<Map<number, Ownership["kind"]>> {
  const [owned, all] = await Promise.all([ownedProductIds(userId), prisma.product.findMany({ select: { id: true, code: true } })]);
  const idByCode = new Map(all.map((p) => [p.code, p.id]));
  const result = new Map<number, Ownership["kind"]>();
  for (const p of products) {
    const parts = p.type === "bundle" ? p.bundleCodes.map((c) => idByCode.get(c)).filter((id): id is number => id !== undefined) : [p.id];
    const have = parts.filter((id) => owned.has(id)).length;
    result.set(p.id, parts.length > 0 && have === parts.length ? "owned" : have > 0 ? "partial" : "none");
  }
  return result;
}
