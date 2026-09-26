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
  // Bot admin qilingan kanallar (yopiq kanal havolasini ID ga moslash uchun)
  known_channels: [] as { id: string; title: string; username?: string }[],
};

export type Settings = typeof DEFAULT_SETTINGS;
export type SettingKey = keyof Settings;

/**
 * Kesh: har bir update da bazaga bormaslik uchun. TTL — bir nechta instansda ishlaganda boshqa
 * instansdagi o'zgarish ham ko'pi bilan CACHE_TTL_MS ichida ko'rinadi (o'zida esa darhol).
 */
const CACHE_TTL_MS = 30_000;
let cache: { value: Settings; at: number } | null = null;
let loading: Promise<Settings> | null = null;
// Yozuvdan oldin boshlangan o'qish eski qiymatni keshga qaytarib qo'ymasligi uchun
let generation = 0;

async function load(): Promise<Settings> {
  const rows = await prisma.setting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) merged[r.key] = r.value;
  return merged as Settings;
}

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  // Bir vaqtda kelgan so'rovlar bitta SELECT ni kutadi (cache stampede yo'q)
  if (!loading) {
    const gen = generation;
    loading = load()
      .then((value) => {
        if (gen === generation) cache = { value, at: Date.now() };
        return value;
      })
      .finally(() => (loading = null));
  }
  return loading;
}

/** Keshni tozalash (testlar va tashqi o'zgarishlar uchun) */
export function invalidateSettings(): void {
  generation++;
  cache = null;
  loading = null;
}

export async function setSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: value as never },
    update: { value: value as never },
  });
  invalidateSettings();
}

/** Admin guruhi: avval sozlamadan (/setgroup), keyin .env dan */
export async function getAdminGroupId(): Promise<bigint | undefined> {
  const s = await getSettings();
  if (s.admin_group_id) return BigInt(s.admin_group_id);
  return config.ADMIN_GROUP_ID;
}
