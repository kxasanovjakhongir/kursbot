import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { prisma } from "../db";

/** Shu jarayonning noyob identifikatori (lease egasi) */
export const INSTANCE_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

/**
 * Lease (muddatli qulf) — Redis'siz, PostgreSQL orqali. Bitta atomik so'rov:
 * yozuv yo'q, muddati o'tgan yoki o'zimizniki bo'lsa — olamiz (va muddatini uzaytiramiz).
 * Egasi o'lib qolsa, ttl tugagach boshqa instans oladi.
 */
export async function acquireLease(name: string, ttlMs: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ owner: string }[]>`
    INSERT INTO job_locks (name, owner, expires_at)
    VALUES (${name}, ${INSTANCE_ID}, now() + make_interval(secs => ${ttlMs / 1000}))
    ON CONFLICT (name) DO UPDATE SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
    WHERE job_locks.expires_at < now() OR job_locks.owner = EXCLUDED.owner
    RETURNING owner`;
  return rows.length === 1;
}

/** Ishni davom ettirishdan oldin: lease hali bizdami (va uzaytirildimi) */
export const renewLease = acquireLease;

export async function releaseLease(name: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM job_locks WHERE name = ${name} AND owner = ${INSTANCE_ID}`;
}

/** Lease olinsa — fn bajariladi (null — boshqa instans bajaryapti) */
export async function withLease<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  if (!(await acquireLease(name, ttlMs))) return null;
  try {
    return await fn();
  } finally {
    await releaseLease(name).catch(() => undefined);
  }
}
