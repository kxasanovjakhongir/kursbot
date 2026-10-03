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

  // Serverning ochiq manzili (tracking link: https://domen.uz/l/<kod>). Berilmasa tracking link yaratilmaydi
  PUBLIC_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), "https:// bilan boshlanishi kerak")
    .optional()
    .or(z.literal("").transform(() => undefined)),

  // --- Email (admin panel: "Parolni unutdim" kodi). SMTP_HOST bo'lmasa xat yuborilmaydi ---
  SMTP_HOST: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional().or(z.literal("").transform(() => undefined)),
  SMTP_PASS: z.string().optional().or(z.literal("").transform(() => undefined)),
  // Jo'natuvchi: "Bot Admin <no-reply@domen.uz>" yoki no-reply@domen.uz
  MAIL_FROM: z.string().trim().optional().or(z.literal("").transform(() => undefined)),

  // --- CRM integratsiyasi ---
  // Telefon ulashilganda lid shu manzilga POST qilinadi. URL ichidagi kalit maxfiy — faqat .env da.
  // Bo'sh bo'lsa integratsiya o'chiq
  CRM_WEBHOOK_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), "https:// bilan boshlanishi kerak")
    .optional()
    .or(z.literal("").transform(() => undefined)),

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
