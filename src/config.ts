import "dotenv/config";
import { z } from "zod";

const splitIds = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const idList = z
  .string()
  .default("")
  .refine((s) => splitIds(s).every((x) => /^\d{1,15}$/.test(x)), "vergul bilan ajratilgan Telegram ID lar bo'lishi kerak")
  .transform((s) => splitIds(s).map((x) => BigInt(x)));

const optionalId = z
  .string()
  .optional()
  .refine((s) => !s?.trim() || /^-?\d{1,20}$/.test(s.trim()), "raqamli chat ID bo'lishi kerak (masalan -1001234567890)")
  .transform((s) => (s && s.trim() ? BigInt(s.trim()) : undefined));

// Spetsifikatsiyadagi nom (TELEGRAM_BOT_TOKEN) ham qabul qilinadi
process.env.BOT_TOKEN ??= process.env.TELEGRAM_BOT_TOKEN;

const schema = z.object({
  BOT_TOKEN: z.string().min(10),
  SUPERADMIN_IDS: idList,
  ADMIN_GROUP_ID: optionalId,
  TECH_CHAT_ID: optionalId,
  SUPPORT_USERNAME: z
    .string()
    .optional()
    .transform((s) => (s ? s.replace(/^@/, "") : undefined)),
  DATABASE_URL: z.string().url(),
  // 2-bosqich (BullMQ eslatmalar) uchun, hozircha ishlatilmaydi
  REDIS_URL: z.string().optional(),
  BOT_MODE: z.enum(["polling", "webhook"]).default("polling"),
  WEBHOOK_URL: z.string().url().optional(),
  // Telegram talabi: 1–256 belgi, A-Z a-z 0-9 _ -
  WEBHOOK_SECRET: z
    .string()
    .regex(/^[\w-]{1,256}$/, "faqat A-Z, a-z, 0-9, _ va - belgilar")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.string().default("info"),

  // --- Unumdorlik va barqarorlik ---
  // Bir vaqtda qayta ishlanadigan update lar (bitta chat ichida tartib baribir saqlanadi)
  BOT_CONCURRENCY: z.coerce.number().int().min(1).max(1000).default(50),
  // Webhook: Telegram bir vaqtda ochadigan ulanishlar (1–100)
  WEBHOOK_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(40),
  // PostgreSQL ulanishlar puli (bitta instance uchun) va bo'sh ulanish kutish vaqti (soniya)
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(200).default(20),
  DB_POOL_TIMEOUT: z.coerce.number().int().min(1).max(120).default(15),
  // To'xtatishda joriy ishlar tugashini kutish (ms)
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  // Xabarlar tarixi va analitika hodisalari saqlanadigan muddat (kun); 0 — o'chirilmaydi
  MESSAGE_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(180),
  EVENT_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(365),
  // /metrics (Prometheus) uchun Bearer token. Berilmasa endpoint o'chiq
  METRICS_TOKEN: z
    .string()
    .min(16, "METRICS_TOKEN kamida 16 belgi")
    .optional()
    .or(z.literal("").transform(() => undefined)),

  // --- Admin panel ---
  JWT_SECRET: z.string().min(32, "JWT_SECRET kamida 32 belgi bo'lishi kerak"),
  JWT_EXPIRES_IN: z.string().default("12h"),
  // Bazadagi bot tokenini shifrlash kaliti. Berilmasa JWT_SECRET dan hosil qilinadi
  ENCRYPTION_KEY: z.string().optional(),
  // Frontend manzili (CORS). Vergul bilan bir nechta
  CLIENT_URL: z.string().default("http://localhost:5173"),

  // --- Telegram Mini App ---
  // Mini App manzili (Telegram faqat HTTPS ni qabul qiladi). Bo'sh bo'lsa botda "Ilovani ochish" tugmasi chiqmaydi
  WEB_APP_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), "https:// bilan boshlanishi kerak (Telegram talabi)")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // Serverning ochiq manzili (tracking link: https://domen.uz/l/<kod>). Berilmasa WEB_APP_URL domeni ishlatiladi
  PUBLIC_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), "https:// bilan boshlanishi kerak")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // BotFather'da Mini App uchun berilgan qisqa nom (t.me/<bot>/<nom>?startapp=kod havolalari uchun). Ixtiyoriy
  WEB_APP_SHORT_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_]{3,30}$/, "3–30 ta lotin harfi, raqam yoki _")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // initData qancha vaqt amal qiladi (soniya). Telegram har ochilishda yangisini beradi
  WEB_APP_AUTH_MAX_AGE: z.coerce.number().int().positive().default(86400),

  // --- Kurs darslari ---
  // true — dars videolarini forward qilish va saqlab olish taqiqlanadi (Telegram protect_content).
  // Standart: false — xaridor videoni ko'ra va yuklab ola oladi
  LESSON_PROTECT_CONTENT: z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

const checked = schema.superRefine((c, ctx) => {
  if (c.BOT_MODE !== "webhook") return;
  if (!c.WEBHOOK_URL) ctx.addIssue({ code: "custom", path: ["WEBHOOK_URL"], message: "webhook rejimida majburiy" });
  if (!c.WEBHOOK_SECRET || c.WEBHOOK_SECRET.length < 16 || c.WEBHOOK_SECRET === "change-me-random-string") {
    ctx.addIssue({ code: "custom", path: ["WEBHOOK_SECRET"], message: "webhook rejimida kamida 16 belgili tasodifiy satr kerak" });
  }
});

function load() {
  const res = checked.safeParse(process.env);
  if (res.success) return res.data;
  // Qiymatlar (tokenlar, parollar) chop etilmaydi — faqat qaysi o'zgaruvchi noto'g'ri ekani
  const problems = res.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`).join("\n");
  throw new Error(`.env sozlamalari noto'g'ri:\n${problems}\n.env.example ga qarang.`);
}

export const config = load();
export type Config = typeof config;
