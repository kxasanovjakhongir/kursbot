import { PrismaClient } from "@prisma/client";
import { config } from "./config";
import { logger } from "./lib/logger";
import { setErrorLogStore } from "./lib/errorSink";
import { dbQueryDuration } from "./lib/metrics";

/**
 * Ulanishlar puli: DATABASE_URL da connection_limit / pool_timeout berilmagan bo'lsa .env dagi
 * DB_POOL_SIZE / DB_POOL_TIMEOUT qo'yiladi. Butun jarayon uchun bitta PrismaClient (bitta pul) —
 * har bir so'rovda yangi ulanish ochilmaydi.
 */
function datasourceUrl(): string {
  const url = new URL(config.DATABASE_URL);
  if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", String(config.DB_POOL_SIZE));
  if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", String(config.DB_POOL_TIMEOUT));
  return url.toString();
}

const SLOW_QUERY_MS = 500;

export const prisma = new PrismaClient({
  datasourceUrl: datasourceUrl(),
  log: [
    { level: "query", emit: "event" },
    { level: "warn", emit: "event" },
    { level: "error", emit: "event" },
  ],
});

// Har bir so'rov davomiyligi metrikaga; sekinlari logga (parametrlarsiz — maxfiy ma'lumot tushmaydi)
prisma.$on("query", (e) => {
  dbQueryDuration.observe(e.duration / 1000);
  if (e.duration > SLOW_QUERY_MS) logger.warn({ ms: e.duration, query: e.query.slice(0, 300) }, "sekin SQL so'rov");
});
prisma.$on("warn", (e) => logger.warn({ target: e.target }, e.message));
prisma.$on("error", (e) => logger.error({ target: e.target }, e.message));
// Texnik xatolar paneldagi "Xatoliklar" bo'limi uchun shu bazaga yoziladi
setErrorLogStore(prisma);
