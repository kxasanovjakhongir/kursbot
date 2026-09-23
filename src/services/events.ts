import { prisma } from "../db";
import { logger } from "../lib/logger";

/** Voronka hodisalari: start, phone, video, order, receipt, approved, joined... (TZ 9.1) */
export async function trackEvent(
  userId: bigint | null,
  name: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.event.create({ data: { userId, name, payload: payload as never } });
  } catch (err) {
    logger.warn({ err, name }, "event yozilmadi");
  }
}

export async function audit(
  adminId: number | null,
  action: string,
  entity: string,
  entityId: string | number | bigint | null,
  before?: unknown,
  after?: unknown,
): Promise<void> {
  const json = (v: unknown) =>
    v === undefined ? undefined : JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
  await prisma.auditLog.create({
    data: {
      adminId,
      action,
      entity,
      entityId: entityId === null ? null : String(entityId),
      before: json(before),
      after: json(after),
    },
  });
}
