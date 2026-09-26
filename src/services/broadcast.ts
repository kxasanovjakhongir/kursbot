import { GrammyError, InputFile, type Api } from "grammy";
import type { Broadcast, BroadcastAudience, MessageType, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../lib/logger";
import { config } from "../config";
import { markBlocked } from "./users";
import { PAID_STATUSES } from "./orders";
import { getAdminGroupId } from "./settings";
import { acquireLease, releaseLease, renewLease } from "./leases";

/** Telegram limiti: sekundiga ~30 xabar. Zaxira bilan 25 (TZ 11.2) */
const SEND_INTERVAL_MS = 40;
const BATCH_SIZE = 100;
const RECIPIENT_CHUNK = 5000;
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
  /** audience = product: shu mahsulot egalari */
  productId: number | null;
  idempotencyKey: string;
  createdById: number;
  media: BroadcastMedia | null;
}

export class BroadcastInputError extends Error {}

/**
 * Zaxira: saqlash chati (admin guruhi yoki super admin) sozlanmagan bo'lsa, media birinchi
 * yuborishgacha shu instans xotirasida turadi. Odatda media darhol Telegram'ga yuklanadi (file_id).
 */
const mediaBuffers = new Map<number, BroadcastMedia>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AudienceFilter {
  audience: BroadcastAudience;
  recipients: string[];
  productId: number | null;
}

/**
 * Auditoriya bo'yicha qabul qiluvchilar. Admin cheklagan foydalanuvchilar hech qachon kirmaydi;
 * ommaviy auditoriyalarda yangiliklardan voz kechganlar ham chiqariladi (nomma-nom tanlanganlar va adminlar bundan mustasno).
 */
async function resolveRecipientIds({ audience, recipients, productId }: AudienceFilter): Promise<{ ids: bigint[]; notFound: string[] }> {
  const base: Prisma.UserWhereInput = { isBot: false, isBanned: false };
  const mass: Prisma.UserWhereInput = { ...base, newsEnabled: true };
  const select = { id: true } as const;
  const idsOf = async (where: Prisma.UserWhereInput) => ({
    ids: (await prisma.user.findMany({ where, select })).map((r) => r.id),
    notFound: [],
  });

  switch (audience) {
    case "all":
      return idsOf(mass);
    case "active":
      return idsOf({ ...mass, isBlocked: false });
    case "buyers":
      return idsOf({ ...mass, orders: { some: { status: { in: PAID_STATUSES } } } });
    case "non_buyers":
      return idsOf({ ...mass, orders: { none: { status: { in: PAID_STATUSES } } } });
    case "product":
      if (!productId) throw new BroadcastInputError("Mahsulot tanlanmagan");
      return idsOf({ ...mass, grants: { some: { productId, revokedAt: null } } });
    case "admins": {
      const admins = await prisma.admin.findMany({ where: { isActive: true }, select: { telegramId: true } });
      return idsOf({ ...base, telegramId: { in: admins.map((a) => a.telegramId) } });
    }
    case "specific":
      break;
  }

  const tokens = [...new Set(recipients.map((r) => r.trim()).filter(Boolean))];
  const telegramIds = tokens.filter((t) => /^\d{1,18}$/.test(t)).map((t) => BigInt(t));
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
/**
 * Media broadcastdan oldin Telegram'ga bir marta yuklanadi va file_id bazada saqlanadi:
 * istalgan instans yubora oladi, server qayta ishga tushsa ham fayl yo'qolmaydi.
 */
async function uploadMedia(api: Api, type: BroadcastMessageType, media: BroadcastMedia): Promise<string | null> {
  const chat = (await getAdminGroupId()) ?? config.SUPERADMIN_IDS[0];
  if (!chat) return null;
  const file = new InputFile(media.buffer, media.fileName);
  const opts = { caption: "📣 Broadcast uchun media yuklandi", disable_notification: true };
  switch (type) {
    case "photo":
      return (await api.sendPhoto(Number(chat), file, opts)).photo.at(-1)?.file_id ?? null;
    case "video":
      return (await api.sendVideo(Number(chat), file, opts)).video.file_id;
    case "document":
      return (await api.sendDocument(Number(chat), file, opts)).document.file_id;
    default:
      return null;
  }
}

export async function createBroadcast(api: Api, input: CreateBroadcastInput): Promise<{ broadcast: Broadcast; created: boolean; notFound: string[] }> {
  const existing = await prisma.broadcast.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { broadcast: existing, created: false, notFound: [] };

  if (input.messageType === "text" && !input.text?.trim()) throw new BroadcastInputError("Xabar matni bo'sh");
  if (input.messageType !== "text" && !input.media) throw new BroadcastInputError("Fayl yuklanmagan");

  const { ids, notFound } = await resolveRecipientIds(input);
  if (ids.length === 0) throw new BroadcastInputError("Qabul qiluvchilar topilmadi");
  const fileId = input.media ? await uploadMedia(api, input.messageType, input.media) : null;

  const broadcast = await prisma.$transaction(async (tx) => {
    const b = await tx.broadcast.create({
      data: {
        messageType: input.messageType,
        text: input.text?.trim() || null,
        fileName: input.media?.fileName ?? null,
        fileId,
        audience: input.audience,
        productId: input.audience === "product" ? input.productId : null,
        total: ids.length,
        idempotencyKey: input.idempotencyKey,
        createdById: input.createdById,
      },
    });
    // Katta auditoriya: PostgreSQL parametrlar limiti (65 535) — qismlarga bo'lib yoziladi
    for (let i = 0; i < ids.length; i += RECIPIENT_CHUNK) {
      await tx.broadcastRecipient.createMany({
        data: ids.slice(i, i + RECIPIENT_CHUNK).map((userId) => ({ broadcastId: b.id, userId })),
        skipDuplicates: true,
      });
    }
    return b;
  }, { timeout: 60_000 });
  if (input.media && !fileId) mediaBuffers.set(broadcast.id, input.media);
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

// ---------- Worker: bir vaqtda bitta broadcast, butun klaster bo'yicha bitta instans ----------

const LEASE = "broadcast-worker";
const LEASE_TTL_MS = 60_000;
const RENEW_EVERY_MS = 15_000;
let workerRunning = false;
let rerun = false;
let stopRequested = false;

/**
 * Bitta broadcast ni yuboradi. false — to'xtatildi (server to'xtamoqda yoki lease boshqa instansga o'tdi):
 * holat "sending" qoladi va keyin davom ettiriladi. Har bir qabul qiluvchi alohida belgilanadi —
 * davom ettirilganda hech kimga ikki marta yuborilmaydi.
 */
async function runBroadcast(api: Api, broadcastId: number): Promise<boolean> {
  let b = await prisma.broadcast.findUnique({ where: { id: broadcastId } });
  if (!b || b.status === "completed" || b.status === "failed") return true;

  if (b.messageType !== "text" && !b.fileId && !mediaBuffers.has(b.id)) {
    // Server media yuklanmasdan qayta ishga tushgan — faylni qayta olishning iloji yo'q
    await prisma.broadcastRecipient.updateMany({
      where: { broadcastId, status: "pending" },
      data: { status: "failed", error: "Media fayl yo'qolgan (server qayta ishga tushgan)" },
    });
    await refreshCounts(broadcastId);
    await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: "failed", finishedAt: new Date() } });
    return true;
  }

  b = await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status: "sending", startedAt: b.startedAt ?? new Date() },
  });
  logger.info({ broadcastId, total: b.total }, "broadcast boshlandi");
  let renewedAt = Date.now();

  for (;;) {
    const batch = await prisma.broadcastRecipient.findMany({
      where: { broadcastId, status: "pending" },
      include: { user: { select: { telegramId: true, isBlocked: true } } },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;

    for (const r of batch) {
      if (stopRequested) {
        await refreshCounts(broadcastId);
        return false;
      }
      if (Date.now() - renewedAt > RENEW_EVERY_MS) {
        if (!(await renewLease(LEASE, LEASE_TTL_MS))) {
          logger.warn({ broadcastId }, "broadcast lease yo'qotildi — boshqa instans davom ettiradi");
          return false;
        }
        renewedAt = Date.now();
      }
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
  return true;
}

/**
 * Navbatdagi broadcastlarni yuboradi. Lease tufayli bir nechta instans bo'lsa ham bir vaqtda faqat
 * bittasi yuboradi (Telegram umumiy limiti va takroriy yuborish yo'q). Instans o'lsa, lease muddati
 * tugagach boshqasi davom ettiradi (fon vazifasi har necha soniyada chaqiradi).
 */
export async function processBroadcasts(api: Api): Promise<void> {
  if (workerRunning) {
    rerun = true; // hozirgi aylanish tugagach yangi broadcast ham olinadi
    return;
  }
  if (stopRequested) return;
  workerRunning = true;
  try {
    do {
      rerun = false;
      if (!(await acquireLease(LEASE, LEASE_TTL_MS))) return;
      try {
        for (;;) {
          const next = await prisma.broadcast.findFirst({ where: { status: { in: ["pending", "sending"] } }, orderBy: { id: "asc" }, select: { id: true } });
          if (!next || stopRequested) break;
          if (!(await runBroadcast(api, next.id))) return;
        }
      } finally {
        await releaseLease(LEASE).catch(() => undefined);
      }
    } while (rerun && !stopRequested);
  } catch (err) {
    logger.error({ err }, "broadcast worker xatosi");
  } finally {
    workerRunning = false;
  }
}

/** Yangi broadcast — darhol yuborish boshlanadi (shu instans lease ololsa; aks holda egasi oladi) */
export function enqueueBroadcast(api: Api): void {
  void processBroadcasts(api);
}

/** Graceful shutdown: joriy xabar yuborilgach to'xtaydi, holat bazada — keyin davom ettiriladi */
export async function stopBroadcastWorker(): Promise<void> {
  stopRequested = true;
  while (workerRunning) await sleep(50);
}

export async function countRecipients(filter: AudienceFilter): Promise<{ count: number; notFound: string[] }> {
  const { ids, notFound } = await resolveRecipientIds(filter);
  return { count: ids.length, notFound };
}
