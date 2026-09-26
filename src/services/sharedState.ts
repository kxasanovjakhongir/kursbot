import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../db";

/** BigInt JSON'ga satr sifatida yoziladi; o'qishda sxema (z.coerce.bigint) qaytaradi */
function toJson(value: unknown): Prisma.InputJsonValue {
  const json: unknown = JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
  return json as Prisma.InputJsonValue;
}

/**
 * Qisqa muddatli suhbat holati (bot_state jadvali): barcha instanslar uchun umumiy.
 * Keyingi update boshqa serverga tushsa ham holat yo'qolmaydi. Bazadagi qiymat har o'qishda
 * sxema bilan tekshiriladi — buzilgan yoki eski formatdagi yozuv e'tiborsiz qoldiriladi.
 */
export class SharedState<S extends z.ZodTypeAny> {
  constructor(
    private readonly namespace: string,
    private readonly ttlMs: number,
    private readonly schema: S,
  ) {}

  private key(id: number | bigint | string): string {
    return `${this.namespace}:${id}`;
  }

  private parse(value: unknown): z.output<S> | undefined {
    const res = this.schema.safeParse(value);
    return res.success ? res.data : undefined;
  }

  async get(id: number | bigint | string): Promise<z.output<S> | undefined> {
    const row = await prisma.botState.findUnique({ where: { key: this.key(id) } });
    if (!row || row.expiresAt <= new Date()) return undefined;
    return this.parse(row.value);
  }

  async set(id: number | bigint | string, value: z.input<S> | z.output<S>): Promise<void> {
    const key = this.key(id);
    const data = { value: toJson(value), expiresAt: new Date(Date.now() + this.ttlMs) };
    await prisma.botState.upsert({ where: { key }, create: { key, ...data }, update: data });
  }

  async delete(id: number | bigint | string): Promise<void> {
    await prisma.botState.deleteMany({ where: { key: this.key(id) } });
  }

  /** Atomik o'qib-o'chirish: bir holatni ikki parallel update (yoki ikki server) ishlata olmaydi */
  async take(id: number | bigint | string): Promise<z.output<S> | undefined> {
    const rows = await prisma.$queryRaw<{ value: unknown }[]>`
      DELETE FROM bot_state WHERE key = ${this.key(id)} AND expires_at > now() RETURNING value`;
    return rows.length ? this.parse(rows[0].value) : undefined;
  }
}

/** Muddati o'tgan holatlarni tozalash (fon vazifasi) */
export async function purgeExpiredState(): Promise<number> {
  const { count } = await prisma.botState.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return count;
}
