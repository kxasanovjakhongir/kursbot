import type { Admin, AdminRole, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";

/**
 * «Admin emas» javobi qisqa vaqt eslab qolinadi: update larning deyarli hammasi oddiy foydalanuvchilardan —
 * har biri uchun admins jadvali o'qilmaydi. Admin topilgan javob ESLAB QOLINMAYDI: huquq olib tashlansa
 * keyingi update dayoq kuchga kiradi (TZ 11.5). Yangi admin shu jarayonda darhol (invalidateAdminCache),
 * boshqa instanslarda ko'pi bilan NOT_ADMIN_TTL_MS dan keyin tanildi.
 */
const NOT_ADMIN_TTL_MS = 30_000;
const NOT_ADMIN_MAX = 100_000;
const notAdmin = new Map<bigint, number>();

export function invalidateAdminCache(): void {
  notAdmin.clear();
}

function rememberNotAdmin(telegramId: bigint): void {
  // Xotira chegaralangan: eng eski yozuv chiqariladi (Map — qo'shilish tartibida)
  if (notAdmin.size >= NOT_ADMIN_MAX) notAdmin.delete(notAdmin.keys().next().value!);
  notAdmin.set(telegramId, Date.now() + NOT_ADMIN_TTL_MS);
}

/** .env dagi birinchi super adminlarni bazaga yozadi (TZ 2.2) */
export async function syncEnvSuperAdmins(): Promise<void> {
  for (const id of config.SUPERADMIN_IDS) {
    await prisma.admin.upsert({
      where: { telegramId: id },
      create: { telegramId: id, role: "superadmin" },
      update: { role: "superadmin", isActive: true },
    });
  }
  invalidateAdminCache();
}

/** Huquq faqat Telegram ID bo'yicha; admin bo'lsa har safar bazadan qayta tekshiriladi (TZ 11.5) */
export async function getAdmin(telegramId: number | bigint | undefined): Promise<Admin | null> {
  if (telegramId === undefined) return null;
  const id = BigInt(telegramId);
  const until = notAdmin.get(id);
  if (until !== undefined) {
    if (until > Date.now()) return null;
    notAdmin.delete(id);
  }
  const admin = await prisma.admin.findUnique({ where: { telegramId: id } });
  if (admin && admin.isActive) return admin;
  rememberNotAdmin(id);
  return null;
}

export function isSuper(admin: Admin | null | undefined): boolean {
  return admin?.role === "superadmin";
}

export async function addAdmin(telegramId: bigint, role: AdminRole, name?: string): Promise<Admin> {
  const admin = await prisma.admin.upsert({
    where: { telegramId },
    create: { telegramId, role, name: name ?? null },
    update: { role, isActive: true, ...(name ? { name } : {}) },
  });
  invalidateAdminCache();
  return admin;
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

export class AdminChangeError extends Error {}

/** Bot orqali o'zgartirib bo'lmaydigan holatlar: .env dagi super admin va o'zini o'zi */
function assertChangeable(actorTelegramId: bigint, targetTelegramId: bigint): void {
  if (config.SUPERADMIN_IDS.includes(targetTelegramId)) {
    throw new AdminChangeError(".env dagi (SUPERADMIN_IDS) super adminni botdan o'zgartirib bo'lmaydi");
  }
  if (actorTelegramId === targetTelegramId) {
    throw new AdminChangeError("O'zingizning rolingizni o'zgartira yoki o'zingizni o'chira olmaysiz");
  }
}

/**
 * Rol o'zgarishi yoki o'chirishdan keyin kamida bitta faol super admin qolishi kerak.
 * Super admin qatorlari qulflanadi — ikki parallel so'rov birga oxirgisini ololmaydi.
 */
async function withSuperAdminGuard<T>(targetTelegramId: bigint, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const supers = await tx.$queryRaw<{ telegram_id: bigint }[]>`
      SELECT telegram_id FROM admins WHERE role = 'superadmin' AND is_active FOR UPDATE`;
    const others = supers.filter((s) => s.telegram_id !== targetTelegramId).length;
    if (others === 0 && supers.some((s) => s.telegram_id === targetTelegramId)) {
      throw new AdminChangeError("Kamida bitta super admin qolishi kerak");
    }
    return fn(tx);
  });
}

/** Faol adminning rolini o'zgartirish (bot ichidagi admin boshqaruvi) */
export async function setAdminRole(actorTelegramId: bigint, telegramId: bigint, role: AdminRole): Promise<Admin> {
  assertChangeable(actorTelegramId, telegramId);
  const change = (tx: Prisma.TransactionClient) => tx.admin.update({ where: { telegramId }, data: { role, isActive: true } });
  const admin = await (role === "admin" ? withSuperAdminGuard(telegramId, change) : prisma.$transaction(change));
  invalidateAdminCache();
  return admin;
}

/** Adminlikdan olish (yozuv saqlanadi — audit tarixi uchun, isActive=false) */
export async function revokeAdmin(actorTelegramId: bigint, telegramId: bigint): Promise<void> {
  assertChangeable(actorTelegramId, telegramId);
  await withSuperAdminGuard(telegramId, (tx) => tx.admin.updateMany({ where: { telegramId }, data: { isActive: false } }));
}

/** Yangi admin qo'shish yoki mavjudining rolini o'rnatish (o'zgartirish qoidalari bilan) */
export async function grantAdmin(actorTelegramId: bigint, telegramId: bigint, role: AdminRole, name: string | null): Promise<{ admin: Admin; created: boolean }> {
  const existing = await prisma.admin.findUnique({ where: { telegramId } });
  if (existing?.isActive) {
    if (existing.role === role) return { admin: existing, created: false };
    return { admin: await setAdminRole(actorTelegramId, telegramId, role), created: false };
  }
  return { admin: await addAdmin(telegramId, role, name ?? undefined), created: true };
}

/**
 * Panel admini ↔ bot admini sinxronlash. Panel adminiga Telegram ID berilsa — o'sha odam botda ham
 * xuddi shu rol bilan faol admin. ID olib tashlansa/almashtirilsa, panel admini o'chirilsa yoki
 * faolsizlantirilsa — botdagi huquq ham olinadi. .env dagi super adminlar hech qachon pasaytirilmaydi.
 * Qaytaradi: yangi huquq berildimi (xabar yuborish uchun).
 */
export async function syncBotAdminFromPanel(
  user: { telegramId: bigint | null; isActive: boolean; role: AdminRole; name: string },
  previousTelegramId: bigint | null,
): Promise<{ granted: AdminRole | null }> {
  const fromEnv = (id: bigint) => config.SUPERADMIN_IDS.includes(id);
  const deactivate = async (id: bigint) => {
    if (!fromEnv(id)) await prisma.admin.updateMany({ where: { telegramId: id }, data: { isActive: false } });
  };

  if (previousTelegramId && previousTelegramId !== user.telegramId) await deactivate(previousTelegramId);
  if (!user.telegramId) return { granted: null };
  if (!user.isActive) {
    await deactivate(user.telegramId);
    return { granted: null };
  }
  const telegramId = user.telegramId;
  const role: AdminRole = fromEnv(telegramId) ? "superadmin" : user.role;
  const before = await prisma.admin.findUnique({ where: { telegramId } });
  await prisma.admin.upsert({
    where: { telegramId },
    create: { telegramId, role, name: user.name },
    update: { role, isActive: true, name: before?.name ?? user.name },
  });
  invalidateAdminCache();
  return { granted: !before?.isActive || before.role !== role ? role : null };
}
