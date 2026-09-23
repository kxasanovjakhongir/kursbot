// Boshlang'ich mahsulotlar (TZ 3.1). Narx, kanal va video keyin admin paneldan kiritiladi.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const products = [
    { code: "4b", title: "4 bosqichli darslik", sortOrder: 1, type: "channel" as const, isActive: true },
    { code: "qd", title: "Qoidalar darsligi", sortOrder: 2, type: "channel" as const, isActive: true },
    // To'plam narxi hozircha noma'lum (TZ 15-bo'lim, 2-savol) — narx kiritilgach /on bundle
    { code: "bundle", title: "To'plam: 4 bosqichli + Qoidalar", sortOrder: 3, type: "bundle" as const, bundleCodes: ["4b", "qd"], isActive: false },
  ];
  for (const p of products) {
    await prisma.product.upsert({ where: { code: p.code }, create: p, update: {} });
  }
  console.log("Seed tayyor:", products.map((p) => p.code).join(", "));
}

main().finally(() => prisma.$disconnect());
