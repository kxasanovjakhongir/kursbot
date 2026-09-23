import { GrammyError, InputFile, type Api } from "grammy";
import type { Broadcast, BroadcastAudience, MessageType, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../lib/logger";
import { markBlocked } from "./users";

/** Telegram limiti: sekundiga ~30 xabar. Zaxira bilan 25 (TZ 11.2) */
const SEND_INTERVAL_MS = 40;
const BATCH_SIZE = 100;
const MAX_RETRIES_429 = 5;

export type BroadcastMessageType = Exclude<MessageType, "other">;

export interface BroadcastMedia {
  buffer: Buffer;
  fileName: string;
}

export interface CreateBroadcastInput {
  messageType: BroadcastMessageType;
  text: string | null;
  audience: BroadcastAudience;
  /** audience = specific: Telegram ID yoki @username lar */
  recipients: string[];
  idempotencyKey: string;
  createdById: number;
  media: BroadcastMedia | null;
}

export class BroadcastInputError extends Error {}

/** Media fayl birinchi yuborishgacha xotirada turadi; keyin Telegram file_id qayta ishlatiladi */
const mediaBuffers = new Map<number, BroadcastMedia>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function resolveRecipientIds(audience: BroadcastAudience, recipients: string[]): Promise<{ ids: bigint[]; notFound: string[] }> {
  const base: Prisma.UserWhereInput = { isBot: false };
  if (audience === "all") {
    const rows = await prisma.user.findMany({ where: base, select: { id: true } });
    return { ids: rows.map((r) => r.id), notFound: [] };
  }
  if (audience === "active") {
    const rows = await prisma.user.findMany({ where: { ...base, isBlocked: false }, select: { id: true } });
    return { ids: rows.map((r) => r.id), notFound: [] };
  }

  const tokens = [...new Set(recipients.map((r) => r.trim()).filter(Boolean))];
  const telegramIds = tokens.filter((t) => /^\d+$/.test(t)).map((t) => BigInt(t));
  const usernames = tokens.filter((t) => !/^\d+$/.test(t)).map((t) => t.replace(/^@/, ""));
  const rows = await prisma.user.findMany({
    where: {
      ...base,
      OR: [
        { telegramId: { in: telegramIds } },
        ...usernames.map((u) => ({ username: { equals: u, mode: "insensitive" as const } })),
      ],
    },
    select: { id: true, telegramId: true, username: true },
  });
  const notFound = tokens.filter((t) => {
    const clean = t.replace(/^@/, "").toLowerCase();
    return !rows.some((r) => r.telegramId.toString() === clean || r.username?.toLowerCase() === clean);
  });
  return { ids: rows.map((r) => r.id), notFound };
}

/**
 * Broadcast yaratadi. Bir xil idempotencyKey bilan qayta chaqirilsa yangisi yaratilmaydi —
 * tugma ikki marta bosilsa ham xabar ikki marta ketmaydi.
 */
export async function createBroadcast(input: CreateBroadcastInput): Promise<{ broadcast: Broadcast; created: boolean; notFound: string[] }> {
  const existing = await prisma.broadcast.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { broadcast: existing, created: false, notFound: [] };

  if (input.messageType === "text" && !input.text?.trim()) throw new BroadcastInputError("Xabar matni bo'sh");
  if (input.messageType !== "text" && !input.media) throw new BroadcastInputError("Fayl yuklanmagan");

  const { ids, notFound } = await resolveRecipientIds(input.audience, input.recipients);
  if (ids.length === 0) throw new BroadcastInputError("Qabul qiluvchilar topilmadi");

  const broadcast = await prisma.$transaction(async (tx) => {
    const b = await tx.broadcast.create({
      data: {
        messageType: input.messageType,
        text: input.text?.trim() || null,
        fileName: input.media?.fileName ?? null,
        audience: input.audience,
        total: ids.length,
        idempotencyKey: input.idempotencyKey,
        createdById: input.createdById,
      },
    });
    await tx.broadcastRecipient.createMany({
      data: ids.map((userId) => ({ broadcastId: b.id, userId })),
      skipDuplicates: true,
    });
    return b;
  });
  if (input.media) mediaBuffers.set(broadcast.id, input.media);
  return { broadcast, created: true, notFound };
}

async function sendOne(api: Api, b: Broadcast, chatId: number): Promise<{ messageId: number; fileId: string | null }> {
  const caption = b.text ?? undefined;
  const buf = mediaBuffers.get(b.id);
  const media = b.fileId ?? (buf ? new InputFile(buf.buffer, buf.fileName) : null);
  if (b.messageType !== "text" && !media) throw new Error("Media fayl mavjud emas");

  switch (b.messageType) {
    case "text": {
      const m = await api.sendMessage(chatId, b.text ?? "");
      return { messageId: m.message_id, fileId: null };
    }
    case "photo": {
      const m = await api.sendPhoto(chatId, media!, { caption });
      return { messageId: m.message_id, fileId: m.photo.at(-1)?.file_id ?? null };
    }
    case "video": {
      const m = await api.sendVideo(chatId, media!, { caption });
      return { messageId: m.message_id, fileId: m.video.file_id };
    }
    case "document": {
      const m = await api.sendDocument(chatId, media!, { caption });
      return { messageId: m.message_id, fileId: m.document.file_id };
    }
    default:
      throw new Error(`Broadcast uchun qo'llab-quvvatlanmaydigan tur: ${b.messageType}`);
  }
}

async function refreshCounts(broadcastId: number): Promise<void> {
  const groups = await prisma.broadcastRecipient.groupBy({
    by: ["status"],
    where: { broadcastId },
    _count: { _all: true },
  });
  const count = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { sent: count("sent"), failed: count("failed"), skipped: count("skipped") },
  });
}

async function runBroadcast(api: Api, broadcastId: number): Promise<void> {
  let b = await prisma.broadcast.findUnique({ where: { id: broadcastId } });
  if (!b || b.status === "completed" || b.status === "failed") return;

  if (b.messageType !== "text" && !b.fileId && !mediaBuffers.has(b.id)) {
    // Server media yuklanmasdan qayta ishga tushgan — faylni qayta olishning iloji yo'q
    await prisma.broadcastRecipient.updateMany({
      where: { broadcastId, status: "pending" },
      data: { status: "failed", error: "Media fayl yo'qolgan (server qayta ishga tushgan)" },
    });
    await refreshCounts(broadcastId);
    await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: "failed", finishedAt: new Date() } });
    return;
  }

  b = await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status: "sending", startedAt: b.startedAt ?? new Date() },
  });
  logger.info({ broadcastId, total: b.total }, "broadcast boshlandi");

  for (;;) {
    const batch = await prisma.broadcastRecipient.findMany({
      where: { broadcastId, status: "pending" },
      include: { user: { select: { telegramId: true, isBlocked: true } } },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;

    for (const r of batch) {
      if (r.user.isBlocked) {
        await prisma.broadcastRecipient.update({ where: { id: r.id }, data: { status: "skipped", error: "Botni bloklagan" } });
        continue;
      }
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await sendOne(api, b, Number(r.user.telegramId));
          await prisma.broadcastRecipient.update({
            where: { id: r.id },
            data: { status: "sent", telegramMessageId: res.messageId, sentAt: new Date() },
          });
          if (res.fileId && !b.fileId) {
            b = await prisma.broadcast.update({ where: { id: b.id }, data: { fileId: res.fileId } });
            mediaBuffers.delete(b.id);
          }
          break;
        } catch (err) {
          if (err instanceof GrammyError && err.error_code === 429 && attempt < MAX_RETRIES_429) {
            const wait = (err.parameters.retry_after ?? 5) * 1000;
            logger.warn({ broadcastId, wait }, "Telegram rate limit — kutilmoqda");
            await sleep(wait);
            continue;
          }
          const blocked = err instanceof GrammyError && err.error_code === 403;
          if (blocked) await markBlocked(r.user.telegramId);
          await prisma.broadcastRecipient.update({
            where: { id: r.id },
            data: {
              status: "failed",
              error: blocked ? "Botni bloklagan" : err instanceof GrammyError ? err.description : String(err),
            },
          });
          break;
        }
      }
      await sleep(SEND_INTERVAL_MS);
    }
    await refreshCounts(broadcastId);
  }

  await refreshCounts(broadcastId);
  await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: "completed", finishedAt: new Date() } });
  mediaBuffers.delete(broadcastId);
  logger.info({ broadcastId }, "broadcast tugadi");
}

/** Bir vaqtda faqat bitta broadcast yuboriladi — umumiy Telegram limitidan oshmaslik uchun */
let queue: Promise<void> = Promise.resolve();

export function enqueueBroadcast(api: Api, broadcastId: number): void {
  queue = queue
    .then(() => runBroadcast(api, broadcastId))
    .catch((err) => logger.error({ err, broadcastId }, "broadcast xatosi"));
}

/** Server qayta ishga tushganda yarim qolgan broadcastlar davom ettiriladi */
export async function resumeBroadcasts(api: Api): Promise<void> {
  const pending = await prisma.broadcast.findMany({
    where: { status: { in: ["pending", "sending"] } },
    orderBy: { id: "asc" },
  });
  for (const b of pending) enqueueBroadcast(api, b.id);
  if (pending.length) logger.info({ count: pending.length }, "broadcastlar davom ettirilmoqda");
}

export async function countRecipients(audience: BroadcastAudience, recipients: string[]): Promise<{ count: number; notFound: string[] }> {
  const { ids, notFound } = await resolveRecipientIds(audience, recipients);
  return { count: ids.length, notFound };
}
