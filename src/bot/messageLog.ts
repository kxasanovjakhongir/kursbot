import type { Api } from "grammy";
import type { Message as TgMessage } from "grammy/types";
import type { MessageDirection, MessageType, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../lib/logger";
import { TtlMap } from "../lib/ttlMap";

export function classifyMessage(m: TgMessage): { type: MessageType; text: string | null } {
  if (m.text !== undefined) return { type: "text", text: m.text };
  if (m.photo) return { type: "photo", text: m.caption ?? null };
  if (m.video) return { type: "video", text: m.caption ?? null };
  if (m.document) return { type: "document", text: m.caption ?? m.document.file_name ?? null };
  const kind = m.contact ? "kontakt" : m.sticker ? "stiker" : m.voice ? "ovozli xabar" : m.video_note ? "video xabar" : "boshqa";
  return { type: "other", text: `[${kind}]` };
}

function isTgMessage(x: unknown): x is TgMessage {
  return typeof x === "object" && x !== null && "message_id" in x && "chat" in x;
}

/** telegramId -> users.id: har bir chiquvchi xabar uchun bazadan qidirmaslik uchun */
const userIds = new TtlMap<number, bigint>(30 * 60_000, 20_000);

async function resolveUserId(telegramId: number): Promise<bigint | null> {
  const cached = userIds.get(telegramId);
  if (cached !== undefined) return cached;
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) }, select: { id: true } });
  if (user) userIds.set(telegramId, user.id);
  return user?.id ?? null;
}

/**
 * Yozuvlar buferi: har bir xabar uchun alohida INSERT o'rniga ~1 soniyada bitta createMany.
 * Tarix muhim, lekin kritik emas — server qulasa oxirgi soniyadagi yozuvlar yo'qolishi mumkin;
 * graceful shutdown da bufer oxirigacha yoziladi (flushMessageLog).
 */
const FLUSH_MS = 1000;
const MAX_BUFFER = 500;
const MAX_PENDING_BATCHES = 40; // baza ishlamay qolsa xotira cheksiz o'smaydi (~20 000 yozuv)
let buffer: Prisma.MessageCreateManyInput[] = [];
let timer: NodeJS.Timeout | null = null;
let flushing: Promise<void> = Promise.resolve();
let pendingBatches = 0;

export function flushMessageLog(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const batch = buffer;
  buffer = [];
  if (batch.length === 0) return flushing;
  if (pendingBatches >= MAX_PENDING_BATCHES) {
    logger.warn({ count: batch.length }, "xabarlar tarixi: baza sekin — yozuvlar tashlab yuborildi");
    return flushing;
  }
  pendingBatches++;
  flushing = flushing.then(() =>
    prisma.message
      .createMany({ data: batch })
      .then(() => undefined)
      .catch((err) => logger.warn({ err, count: batch.length }, "xabarlar tarixi yozilmadi"))
      .finally(() => pendingBatches--),
  );
  return flushing;
}

function save(userId: bigint, direction: MessageDirection, m: TgMessage): void {
  const { type, text } = classifyMessage(m);
  buffer.push({ userId, direction, messageType: type, text, telegramMessageId: m.message_id });
  if (buffer.length >= MAX_BUFFER) void flushMessageLog();
  else timer ??= setTimeout(() => void flushMessageLog(), FLUSH_MS);
}

/** userId — kontekstdagi foydalanuvchi (identify middleware allaqachon topgan) */
export async function logIncoming(m: TgMessage, userId: bigint | null | undefined): Promise<void> {
  if (m.chat.type !== "private" || !m.from || !userId) return;
  userIds.set(m.from.id, userId);
  save(userId, "incoming", m);
}

const OUTGOING_METHODS = new Set(["sendMessage", "sendPhoto", "sendVideo", "sendDocument", "sendAudio", "sendVoice", "sendAnimation"]);

/** Bot shaxsiy chatlarga yuborgan barcha xabarlar tarixga yoziladi (API transformer) */
export function installOutgoingLogger(api: Api): void {
  api.config.use(async (prev, method, payload, signal) => {
    const res = await prev(method, payload, signal);
    if (res.ok && OUTGOING_METHODS.has(method) && "chat_id" in payload) {
      const chatId = Number(payload.chat_id);
      const result: unknown = res.result;
      if (chatId > 0 && isTgMessage(result)) {
        void resolveUserId(chatId)
          .then((userId) => (userId ? save(userId, "outgoing", result) : undefined))
          .catch((err) => logger.warn({ err }, "chiquvchi xabar yozilmadi"));
      }
    }
    return res;
  });
}
