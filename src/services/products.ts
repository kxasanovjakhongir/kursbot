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
