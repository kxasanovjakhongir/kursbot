import type { NextFunction } from "grammy";
import type { BotContext } from "../context";

/**
 * Inline tugma bosilganda Telegram javob kutadi — javob bo'lmasa tugmada "soat" aylanib turadi.
 * Handler javob bermagan bo'lsa (yoki xato bilan tugasa) shu yerda bo'sh javob yuboriladi.
 */
export async function autoAnswerCallbacks(ctx: BotContext, next: NextFunction): Promise<void> {
  if (!ctx.callbackQuery) return next();
  let answered = false;
  const original = ctx.answerCallbackQuery.bind(ctx);
  ctx.answerCallbackQuery = (...args: Parameters<BotContext["answerCallbackQuery"]>) => {
    answered = true;
    return original(...args);
  };
  try {
    await next();
  } finally {
    if (!answered) await original().catch(() => undefined);
  }
}
