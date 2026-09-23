import type { Admin, AdminRole } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";

/** .env dagi birinchi super adminlarni bazaga yozadi (TZ 2.2) */
export async function syncEnvSuperAdmins(): Promise<void> {
  for (const id of config.SUPERADMIN_IDS) {
    await prisma.admin.upsert({
      where: { telegramId: id },
      create: { telegramId: id, role: "superadmin" },
      update: { role: "superadmin", isActive: true },
    });
  }
}

/** Huquq faqat Telegram ID bo'yicha, har safar qayta tekshiriladi (TZ 11.5) */
export async function getAdmin(telegramId: number | bigint | undefined): Promise<Admin | null> {
  if (telegramId === undefined) return null;
  const admin = await prisma.admin.findUnique({ where: { telegramId: BigInt(telegramId) } });
  return admin && admin.isActive ? admin : null;
}

export function isSuper(admin: Admin | null | undefined): boolean {
  return admin?.role === "superadmin";
}

export async function addAdmin(telegramId: bigint, role: AdminRole, name?: string): Promise<Admin> {
  return prisma.admin.upsert({
    where: { telegramId },
    create: { telegramId, role, name: name ?? null },
    update: { role, isActive: true, ...(name ? { name } : {}) },
  });
}

export async function removeAdmin(telegramId: bigint): Promise<boolean> {
  if (config.SUPERADMIN_IDS.includes(telegramId)) return false;
  const res = await prisma.admin.updateMany({ where: { telegramId }, data: { isActive: false } });
  return res.count > 0;
}

export async function listAdmins(): Promise<Admin[]> {
  return prisma.admin.findMany({ where: { isActive: true }, orderBy: { id: "asc" } });
}

export async function superAdminIds(): Promise<bigint[]> {
  const rows = await prisma.admin.findMany({ where: { isActive: true, role: "superadmin" } });
  return rows.map((r) => r.telegramId);
}
