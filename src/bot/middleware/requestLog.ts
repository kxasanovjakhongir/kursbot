import type { NextFunction } from "grammy";
import type { BotContext } from "../context";
import { logger } from "../../lib/logger";
import { botUpdateDuration, botUpdates, botUpdatesInFlight } from "../../lib/metrics";

const SLOW_MS = 3000;

function updateType(ctx: BotContext): string {
  return Object.keys(ctx.update).find((k) => k !== "update_id") ?? "unknown";
}

/** Nima qilindi: buyruq nomi yoki callback_data. Foydalanuvchi yozgan matn logga tushmaydi (maxfiylik) */
function actionOf(ctx: BotContext): { command?: string; callback?: string } {
  const text = ctx.message?.text;
  if (text?.startsWith("/")) return { command: text.split(/[\s@]/)[0].slice(0, 64) };
  if (ctx.callbackQuery?.data) return { callback: ctx.callbackQuery.data.slice(0, 64) };
  return {};
}

/**
 * Har bir update uchun kontekstli logger (updateId, userId, chatId, tur, action) va davomiylik.
 * Buyruq va tugmalar — info, qolganlari — debug, sekin update lar — warn.
 */
export async function requestLog(ctx: BotContext, next: NextFunction): Promise<void> {
  const started = Date.now();
  const action = actionOf(ctx);
  const type = updateType(ctx);
  ctx.log = logger.child({
    updateId: ctx.update.update_id,
    userId: ctx.from?.id,
    chatId: ctx.chat?.id,
    type,
    ...action,
  });
  botUpdatesInFlight.inc();
  try {
    await next();
  } finally {
    const ms = Date.now() - started;
    botUpdatesInFlight.dec();
    botUpdateDuration.observe({ type }, ms / 1000);
    // "ignore"/"blocked" — zararsiz holatlar, xato hisoblanmaydi
    const status = ctx.failure === "retry" ? "retry" : ctx.failure && ctx.failure !== "ignore" && ctx.failure !== "blocked" ? "error" : "ok";
    botUpdates.inc({ type, status });
    if (ms > SLOW_MS) ctx.log.warn({ ms, status }, "sekin update");
    else if (action.command || action.callback || status === "error") ctx.log.info({ ms, status }, "update");
    else ctx.log.debug({ ms }, "update");
  }
}
