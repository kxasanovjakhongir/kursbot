import { prisma } from "../db";
import { config } from "../config";

/** Standart qiymatlar (TZ 6-bo'lim, qavs ichidagilar). Super admin o'zgartira oladi. */
export const DEFAULT_SETTINGS = {
  work_start: "09:00",
  work_end: "22:00",
  order_ttl_hours: 72,
  max_receipt_attempts: 3,
  invite_link_days: 7,
  receipt_max_mb: 10,
  admin_group_id: null as string | null,
  // Admin panel sozlamalari
  welcome_message: null as string | null,
  maintenance_mode: false,
  default_language: "uz",
  // Bot tokeni (AES-256-GCM bilan shifrlangan). null bo'lsa .env dagi token ishlatiladi
  bot_token_enc: null as string | null,
};

export type Settings = typeof DEFAULT_SETTINGS;
export type SettingKey = keyof Settings;

let cache: Settings | null = null;

export async function getSettings(): Promise<Settings> {
  if (cache) return cache;
  const rows = await prisma.setting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) merged[r.key] = r.value;
  cache = merged as Settings;
  return cache;
}

export async function setSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: value as never },
    update: { value: value as never },
  });
  cache = null;
}

/** Admin guruhi: avval sozlamadan (/setgroup), keyin .env dan */
export async function getAdminGroupId(): Promise<bigint | undefined> {
  const s = await getSettings();
  if (s.admin_group_id) return BigInt(s.admin_group_id);
  return config.ADMIN_GROUP_ID;
}
