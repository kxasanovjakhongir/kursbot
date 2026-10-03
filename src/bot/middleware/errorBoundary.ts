import { GrammyError, HttpError, type NextFunction } from "grammy";
import { Prisma } from "@prisma/client";
import type { BotContext } from "../context";
import { cachedText, guessLang, type TextKey } from "../../i18n";
import { alertTech } from "../notify";

export type ErrorKind = "ignore" | "blocked" | "database" | "network" | "generic";

/**
 * Webhook rejimida baza vaqtincha ishlamasa, update "yo'qolmasligi" uchun Telegram'ga xato qaytariladi —
 * Telegram uni keyinroq qayta yuboradi (amal baza tiklangach bajariladi). Takroriy yetkazish xavfsiz:
 * to'lov/buyurtma oqimlari idempotent (atomik status o'tishlari, unique indekslar).
 * Polling (runner) da qayta yuborish yo'q — u yerda foydalanuvchiga "keyinroq urinib ko'ring" deyiladi.
 */
export class RetryLaterError extends Error {}
let retryDatabaseErrors = false;
export function setRetryDatabaseErrors(enabled: boolean): void {
  retryDatabaseErrors = enabled;
}

/** Xatoni turkumlaydi: foydalanuvchiga nima deyish va developerga qanday xabar berish shunga bog'liq */
export function classifyError(err: unknown): ErrorKind {
  if (err instanceof GrammyError) {
    if (err.error_code === 403) return "blocked";
    const d = err.description;
    // Zararsiz: bir xil matn qayta tahrirlandi yoki eski tugma bosildi
    if (d.includes("message is not modified") || d.includes("query is too old") || d.includes("query ID is invalid")) return "ignore";
    return "generic";
  }
  if (err instanceof HttpError) return "network";
  if (
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientUnknownRequestError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError ||
    err instanceof Prisma.PrismaClientValidationError
  ) {
    return "database";
  }
  return "generic";
}

const USER_MESSAGE: Record<Exclude<ErrorKind, "ignore" | "blocked">, TextKey> = {
  database: "error_database",
  network: "error_generic",
  generic: "error_generic",
};

function errorText(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}

/**
 * Handlerdagi har qanday xato shu yerda ushlanadi:
 * developer uchun — to'liq log va texnik chatga ogohlantirish,
 * foydalanuvchi uchun — texnik tafsilotsiz tushunarli xabar (o'z tilida).
 */
export async function handleBotError(ctx: BotContext, err: unknown): Promise<void> {
  const kind = classifyError(err);
  ctx.failure = kind;
  if (kind === "ignore" || kind === "blocked") {
    ctx.log.debug({ err, kind }, "zararsiz xato");
    return;
  }
  if (kind === "database" && retryDatabaseErrors) {
    ctx.failure = "retry";
    ctx.log.warn({ err }, "baza vaqtincha ishlamayapti — update Telegram tomonidan qayta yuboriladi");
    throw new RetryLaterError("database unavailable");
  }
  ctx.log.error({ err, kind }, "bot xatosi");
  await alertTech(ctx.api, `[${kind}] update ${ctx.update.update_id}\n${errorText(err)}`);

  // Guruh va kanallarda foydalanuvchiga xabar yozilmaydi
  if (ctx.chat?.type !== "private") {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => undefined);
    return;
  }
  // Baza ishlamasa foydalanuvchi tili noma'lum bo'lishi mumkin — matn fayldan (bazasiz) olinadi
  const lang = ctx.user ? ctx.lang : guessLang(ctx.from?.language_code);
  const text = cachedText(lang, USER_MESSAGE[kind]);
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text, show_alert: true }).catch(() => undefined);
    return;
  }
  await ctx.reply(text, { parse_mode: "HTML" }).catch(() => undefined);
}

export async function errorBoundary(ctx: BotContext, next: NextFunction): Promise<void> {
  try {
    await next();
  } catch (err) {
    await handleBotError(ctx, err);
  }
}
