// Boshlang'ich mahsulotlar (TZ 3.1). Narx, kanal va video keyin admin paneldan kiritiladi.
import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
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
  console.log("Mahsulotlar:", products.map((p) => p.code).join(", "));

  // Telegram "Menu" tugmasi (admin paneldan boshqariladi)
  const menu = [
    { name: "START", command: "start", description: "Boshlash", order: 1 },
    { name: "HELP", command: "help", description: "Yordam", order: 3 },
    { name: "CONTACT", command: "contact", description: "Bog'lanish", order: 4 },
    { name: "PROFIL", command: "profile", description: "Profil", order: 5 },
    { name: "SOZLAMALAR", command: "settings", description: "Sozlamalar (til, yangiliklar)", order: 6 },
  ];
  for (const m of menu) await prisma.botMenuItem.upsert({ where: { command: m.command }, create: m, update: {} });

  // Javobi bazadan olinadigan buyruqlar
  const commands = [
    {
      command: "help",
      description: "Yordam",
      response:
        "Sizga yordam berish uchun:\n• /start — darsliklar ro'yxati\n• /profile — profil\n• /settings — til va sozlamalar\n• /contact — admin bilan bog'lanish",
    },
    { command: "about", description: "Biz haqimizda", response: "Biz darsliklarni Telegram yopiq kanallari orqali taqdim etamiz." },
    { command: "contact", description: "Bog'lanish", response: "Savollar bo'yicha adminga yozing." },
  ];
  for (const c of commands) await prisma.botCommand.upsert({ where: { command: c.command }, create: c, update: {} });
  console.log("Menyu va buyruqlar tayyor");

  // Birinchi SUPER_ADMIN (admin panel)
  if ((await prisma.panelUser.count()) === 0) {
    const email = (process.env.ADMIN_EMAIL || "admin@example.com").toLowerCase();
    const generated = !process.env.ADMIN_PASSWORD;
    const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString("base64url");
    await prisma.panelUser.create({
      data: { email, name: "Super Admin", role: "superadmin", passwordHash: await bcrypt.hash(password, 12) },
    });
    console.log(`SUPER_ADMIN yaratildi: ${email}`);
    if (generated) console.log(`Parol (bir marta ko'rsatiladi, panelda o'zgartiring): ${password}`);
  }
}

main().finally(() => prisma.$disconnect());
