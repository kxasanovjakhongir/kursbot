import { GrammyError, type InlineKeyboard } from "grammy";
import type { BotContext } from "../context";

/** Bot "ekrani": matn (HTML) va inline tugmalar */
export interface Screen {
  text: string;
  keyboard?: InlineKeyboard;
}

export function isNotModified(err: unknown): boolean {
  return err instanceof GrammyError && err.description.includes("message is not modified");
}

function sendOptions(screen: Screen) {
  return {
    parse_mode: "HTML" as const,
    // Paneldan barcha tugmalari o'chirilgan ekran — bo'sh klaviatura yuborilmaydi
    reply_markup: screen.keyboard?.inline_keyboard.some((row) => row.length > 0) ? screen.keyboard : undefined,
    link_preview_options: { is_disabled: true },
  };
}

/**
 * Ekranni ko'rsatadi. Inline tugma bosilgan bo'lsa — o'sha xabar tahrirlanadi (chat to'lib ketmaydi),
 * aks holda (buyruq, reply-klaviatura, media xabar) yangi xabar yuboriladi.
 */
export async function render(ctx: BotContext, screen: Screen): Promise<void> {
  const msg = ctx.callbackQuery?.message;
  if (msg && msg.text !== undefined) {
    try {
      await ctx.editMessageText(screen.text, sendOptions(screen));
      return;
    } catch (err) {
      if (isNotModified(err)) return;
      // 48 soatdan eski yoki o'chirilgan xabarni tahrirlab bo'lmaydi — yangisini yuboramiz
      if (!(err instanceof GrammyError)) throw err;
    }
  }
  await ctx.reply(screen.text, sendOptions(screen));
}

/** Har doim yangi xabar (masalan, to'lov ma'lumoti chatda saqlanib qolishi kerak) */
export async function renderNew(ctx: BotContext, screen: Screen): Promise<void> {
  await ctx.reply(screen.text, sendOptions(screen));
}

/**
 * Bazaga og'irroq so'rovli ekranlar uchun yuklanish holati:
 * - inline tugmada — "⏳" bildirishnoma, keyin xabar tahrirlanadi;
 * - reply-klaviatura/buyruqda — "⏳ Ma'lumotlar yuklanmoqda..." xabari chiqadi va natija bilan almashtiriladi.
 */
export async function renderLoading(ctx: BotContext, build: () => Promise<Screen>): Promise<void> {
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: ctx.label("loading") }).catch(() => undefined);
    return render(ctx, await build());
  }
  const placeholder = await ctx.reply(ctx.label("loading"));
  let screen: Screen;
  try {
    screen = await build();
  } catch (err) {
    await ctx.api.deleteMessage(placeholder.chat.id, placeholder.message_id).catch(() => undefined);
    throw err;
  }
  try {
    await ctx.api.editMessageText(placeholder.chat.id, placeholder.message_id, screen.text, sendOptions(screen));
  } catch (err) {
    if (isNotModified(err)) return;
    await ctx.api.deleteMessage(placeholder.chat.id, placeholder.message_id).catch(() => undefined);
    await ctx.reply(screen.text, sendOptions(screen));
  }
}

export interface Page<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
}

/** Ro'yxatni sahifalarga bo'ladi. Sahifa raqami chegaradan chiqsa — eng yaqin mavjud sahifa */
export function paginate<T>(all: T[], page: number, pageSize: number): Page<T> {
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  return { items: all.slice((current - 1) * pageSize, current * pageSize), page: current, pages, total: all.length };
}
