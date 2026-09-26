import type { NextFunction } from "grammy";
import type { BotContext } from "../context";
import { TtlMap } from "../../lib/ttlMap";
import { getSettings } from "../../services/settings";

/** Cheklangan foydalanuvchiga ogohlantirish tez-tez takrorlanmaydi */
const bannedNotified = new TtlMap<number, true>(10 * 60_000);

/**
 * Shaxsiy chatdagi oddiy foydalanuvchilar uchun kirish nazorati:
 * admin tomonidan cheklangan bo'lsa yoki bot texnik xizmatda bo'lsa — handlerlarga o'tmaydi.
 * Adminlar har doim ishlashda davom etadi.
 */
export async function accessGuard(ctx: BotContext, next: NextFunction): Promise<void> {
  if (ctx.admin || ctx.chat?.type !== "private") return next();

  if (ctx.user?.isBanned) {
    const id = ctx.from!.id;
    const first = !bannedNotified.has(id);
    bannedNotified.set(id, true);
    const text = await ctx.t("error_banned");
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text, show_alert: true }).catch(() => undefined);
    else if (first) await ctx.reply(text);
    return;
  }

  const { maintenance_mode } = await getSettings();
  if (!maintenance_mode) return next();
  if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => undefined);
  await ctx.reply(await ctx.t("maintenance"));
}
