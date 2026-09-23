import type { Api } from "grammy";
import type { Message as TgMessage } from "grammy/types";
import type { MessageDirection, MessageType } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../lib/logger";

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

async function save(telegramId: number, direction: MessageDirection, m: TgMessage): Promise<void> {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) }, select: { id: true } });
  if (!user) return;
  const { type, text } = classifyMessage(m);
  await prisma.message.create({
    data: { userId: user.id, direction, messageType: type, text, telegramMessageId: m.message_id },
  });
}

export async function logIncoming(m: TgMessage): Promise<void> {
  if (m.chat.type !== "private" || !m.from) return;
  await save(m.from.id, "incoming", m).catch((err) => logger.warn({ err }, "kiruvchi xabar yozilmadi"));
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
        void save(chatId, "outgoing", result).catch((err) => logger.warn({ err }, "chiquvchi xabar yozilmadi"));
      }
    }
    return res;
  });
}
