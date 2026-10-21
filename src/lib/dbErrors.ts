import { Prisma } from "@prisma/client";

/**
 * Bazaga ulanish vaqtincha uzildi (baza qayta ishga tushdi, tarmoq uzilishi, pul to'ldi) — Prisma keyingi
 * so'rovda o'zi qayta ulanadi. Bunday xatolar bir marta bo'lsa xato emas, ogohlantirish.
 */
const TRANSIENT_DB_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);
// Postgres SQLSTATE: 57P01 — baza to'xtatildi (administrator buyrug'i, qayta ishga tushish), 57P02 — avariyaviy
// qayta ishga tushish, 57P03 — baza hali ishga tushmoqda. Ulanishlar pulidagi har bir ulanish alohida xabar beradi
const TRANSIENT_DB_MESSAGE =
  /Server has closed the connection|Can't reach database server|Timed out fetching a new connection|Connection reset by peer|E57P0[123]|terminating connection due to administrator command|the database system is (starting up|shutting down)/i;

export function isTransientDbMessage(message: string): boolean {
  return TRANSIENT_DB_MESSAGE.test(message);
}

export function isTransientDbError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError && TRANSIENT_DB_CODES.has(err.code)) return true;
  return err instanceof Error && isTransientDbMessage(err.message);
}
