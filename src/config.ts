import "dotenv/config";
import { z } from "zod";

const idList = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => BigInt(x)),
  );

const optionalId = z
  .string()
  .optional()
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
  REDIS_URL: z.string().default("redis://localhost:6379"),
  BOT_MODE: z.enum(["polling", "webhook"]).default("polling"),
  WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.string().default("info"),

  // --- Admin panel ---
  JWT_SECRET: z.string().min(32, "JWT_SECRET kamida 32 belgi bo'lishi kerak"),
  JWT_EXPIRES_IN: z.string().default("12h"),
  // Bazadagi bot tokenini shifrlash kaliti. Berilmasa JWT_SECRET dan hosil qilinadi
  ENCRYPTION_KEY: z.string().optional(),
  // Frontend manzili (CORS). Vergul bilan bir nechta
  CLIENT_URL: z.string().default("http://localhost:5173"),
});

export const config = schema.parse(process.env);
export type Config = typeof config;
