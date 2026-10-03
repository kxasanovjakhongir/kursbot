import { Prisma } from "@prisma/client";
import { GrammyError, type Api } from "grammy";
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "grammy/types";
import { prisma } from "../db";
import { logger } from "../lib/logger";
import { CB } from "../bot/ui/callbacks";
import { getSupportUrl } from "./settings";

/**
 * "Yordam" URL tugmalari to'g'ridan-to'g'ri t.me profilini ochadi, lekin Telegram havolani xabar
 * yuborilgan paytdagi holatida saqlaydi. Shuning uchun bunday xabarlar eslab qolinadi va paneldan
 * username o'zgartirilgach fon vazifasi (syncSupportButtons) ulardagi tugmalarni yangi havolaga almashtiradi.
 */

const TRACKED_METHODS = new Set(["sendMessage", "sendPhoto", "sendVideo", "sendDocument", "editMessageText", "editMessageCaption", "editMessageReplyMarkup"]);
const RETENTION_DAYS = 90;
const SYNC_BATCH = 200;
// Telegram umumiy limiti ~30 xabar/s; broadcast bilan bo'lishish uchun sekinroq
const EDIT_DELAY_MS = 50;

type Payload = Record<string, unknown>;

/**
 * Jadval hali yaratilmagan (migratsiya qo'llanmagan) — bot ishlashda davom etadi, eski tugmalar
 * yangilanmaydi; logga har 20 soniyada xato emas, bir marta tushunarli ogohlantirish yoziladi.
 */
let missingTableWarned = false;
function isMissingTable(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2021") return false;
  if (!missingTableWarned) {
    missingTableWarned = true;
    logger.warn("support_button_messages jadvali yo'q — `npx prisma migrate deploy` bajaring. Eski xabarlardagi «Yordam» tugmalari yangilanmaydi");
  }
  return true;
}

function inlineKeyboard(markup: unknown): InlineKeyboardButton[][] | null {
  const rows = (markup as InlineKeyboardMarkup | undefined)?.inline_keyboard;
  return Array.isArray(rows) ? rows : null;
}

function hasUrl(rows: InlineKeyboardButton[][], url: string): boolean {
  return rows.some((row) => row.some((b) => "url" in b && b.url === url));
}

/** Xabar identifikatori: send* — javobdagi xabar, edit* — so'rovdagi chat_id/message_id */
function messageRef(method: string, payload: Payload, result: unknown): { chatId: bigint; messageId: number } | null {
  const r = result as { message_id?: number; chat?: { id?: number } } | true;
  const chatId = method.startsWith("send") ? (r !== true ? r.chat?.id : undefined) : Number(payload.chat_id);
  const messageId = method.startsWith("send") ? (r !== true ? r.message_id : undefined) : Number(payload.message_id);
  // Faqat shaxsiy chatlar (guruhdagi admin kartochkalarida support tugmasi yo'q)
  if (!chatId || chatId <= 0 || !messageId || !Number.isInteger(messageId)) return null;
  return { chatId: BigInt(chatId), messageId };
}

async function record(method: string, payload: Payload, result: unknown): Promise<void> {
  const ref = messageRef(method, payload, result);
  if (!ref) return;
  const rows = inlineKeyboard(payload.reply_markup);
  const url = rows ? await getSupportUrl() : null;
  const where = { chatId_messageId: ref };
  if (rows && url && hasUrl(rows, url)) {
    // InlineKeyboard (grammy klassi) — oddiy JSON ga
    const markup = JSON.parse(JSON.stringify({ inline_keyboard: rows }));
    await prisma.supportButtonMessage.upsert({ where, create: { ...ref, url, markup }, update: { url, markup } });
  } else if (!method.startsWith("send")) {
    // Ekran almashdi — xabarda endi support tugmasi yo'q
    await prisma.supportButtonMessage.deleteMany({ where: ref });
  }
}

/** API transformer: support URL tugmali xabarlarni eslab qoladi */
export function installSupportButtonTracker(api: Api): void {
  api.config.use(async (prev, method, payload, signal) => {
    const res = await prev(method, payload, signal);
    if (res.ok && TRACKED_METHODS.has(method)) {
      void record(method, payload as Payload, res.result).catch((err) => {
        if (!isMissingTable(err)) logger.warn({ err }, "support tugmali xabar yozilmadi");
      });
    }
    return res;
  });
}

/** Eski havolali tugmalar yangisiga; username o'chirilgan bo'lsa — yordam ekraniga (callback) */
function replaceUrl(rows: InlineKeyboardButton[][], oldUrl: string, newUrl: string | null): InlineKeyboardButton[][] {
  return rows.map((row) =>
    row.map((b): InlineKeyboardButton => {
      if (!("url" in b) || b.url !== oldUrl) return b;
      return newUrl ? { text: b.text, url: newUrl } : { text: b.text, callback_data: CB.help };
    }),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fon vazifasi: joriy username'dan farqli havolali xabarlardagi tugmalarni yangilaydi.
 * Tahrirlangan xabar tracker orqali yangi havola bilan qayta yoziladi (yoki tugma qolmasa o'chiriladi).
 */
export async function syncSupportButtons(api: Api): Promise<number> {
  const current = await getSupportUrl();
  let stale;
  try {
    stale = await prisma.supportButtonMessage.findMany({
      where: current ? { url: { not: current } } : {},
      orderBy: { updatedAt: "desc" },
      take: SYNC_BATCH,
    });
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
  let updated = 0;
  for (const m of stale) {
    const rows = inlineKeyboard(m.markup);
    const ref = { chatId: m.chatId, messageId: m.messageId };
    try {
      if (!rows) throw new Error("markup yo'q");
      await api.editMessageReplyMarkup(Number(m.chatId), m.messageId, { reply_markup: { inline_keyboard: replaceUrl(rows, m.url, current) } });
      updated++;
      if (current) {
        const markup = JSON.parse(JSON.stringify({ inline_keyboard: replaceUrl(rows, m.url, current) }));
        await prisma.supportButtonMessage.update({ where: { chatId_messageId: ref }, data: { url: current, markup } });
      } else {
        // URL tugma qolmadi (yordam ekraniga callback) — kuzatish shart emas
        await prisma.supportButtonMessage.deleteMany({ where: ref });
      }
    } catch (err) {
      if (err instanceof GrammyError && err.description.includes("message is not modified")) {
        if (current) await prisma.supportButtonMessage.update({ where: { chatId_messageId: ref }, data: { url: current } });
        else await prisma.supportButtonMessage.deleteMany({ where: ref });
      } else if (err instanceof GrammyError || !rows) {
        // Xabar o'chirilgan, bot bloklangan va h.k. — bu xabarni boshqa tahrirlab bo'lmaydi
        await prisma.supportButtonMessage.deleteMany({ where: ref });
      } else {
        throw err;
      }
    }
    await sleep(EDIT_DELAY_MS);
  }
  if (updated) logger.info({ updated, url: current }, "support tugmalari yangilandi");
  return updated;
}

/** Texnik tozalash: juda eski xabarlar kuzatilmaydi */
export async function purgeOldSupportButtons(): Promise<number> {
  const before = new Date(Date.now() - RETENTION_DAYS * 86400_000);
  try {
    return (await prisma.supportButtonMessage.deleteMany({ where: { updatedAt: { lt: before } } })).count;
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
}
