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
});

export const config = schema.parse(process.env);
export type Config = typeof config;
