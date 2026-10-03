import type { NextFunction } from "grammy";
import type { BotContext } from "../context";
import { cachedText, guessLang } from "../../i18n";
import { TtlMap } from "../../lib/ttlMap";

export interface ThrottleOptions {
  /** Oyna uzunligi */
  windowMs: number;
  /** Oyna ichida ruxsat etilgan update lar soni */
  limit: number;
}

/**
 * Spam himoyasi (shaxsiy chat): bir foydalanuvchidan oynada `limit` tadan ko'p update kelsa,
 * ortiqchasi bazaga tegmasdan tashlanadi va foydalanuvchi bir marta ogohlantiriladi.
 */
export function throttle({ windowMs, limit }: ThrottleOptions) {
  const hits = new TtlMap<number, { count: number; warned: boolean }>(windowMs, 50_000);

  return async (ctx: BotContext, next: NextFunction): Promise<void> => {
    if (ctx.chat?.type !== "private" || !ctx.from) return next();
    const entry = hits.get(ctx.from.id);
    if (!entry) {
      hits.set(ctx.from.id, { count: 1, warned: false });
      return next();
    }
    entry.count += 1;
    if (entry.count <= limit) return next();

    const text = cachedText(guessLang(ctx.from.language_code), "error_too_many");
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery(entry.warned ? undefined : { text }).catch(() => undefined);
    } else if (!entry.warned) {
      await ctx.reply(text, { parse_mode: "HTML" }).catch(() => undefined);
    }
    if (!entry.warned) ctx.log.warn({ count: entry.count }, "rate limit: update lar tashlanmoqda");
    entry.warned = true;
  };
}
