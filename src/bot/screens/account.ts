import { InlineKeyboard } from "grammy";
import type { NotificationKind } from "@prisma/client";
import type { BotContext } from "../context";
import { withPagination, withScreenButtons } from "../keyboards";
import { hasTextOverride, joinParts, LANG_NAMES, LANGS } from "../../i18n";
import { escapeHtml, formatDate, formatPhone, formatShortDateTime, formatSum, stripHtml, truncate } from "../../lib/format";
import { buttonSwitch } from "../../services/buttons";
import { listNotifications } from "../../services/notifications";
import { getSupportUrl } from "../../services/settings";
import { displayName, userStats } from "../../services/users";
import { CB } from "../ui/callbacks";
import type { Screen } from "../ui/render";

/** 👤 Profil: shaxsiy ma'lumotlar va xaridlar statistikasi */
export async function profileScreen(ctx: BotContext): Promise<Screen> {
  const user = ctx.user!;
  const stats = await userStats(user.id);
  const text = await ctx.t("profile", {
    ism: displayName(user),
    username: user.username ? `@${user.username}` : ctx.label("not_set"),
    id: user.telegramId.toString(),
    telefon: user.phone ? formatPhone(user.phone) : ctx.label("not_set"),
    til: LANG_NAMES[ctx.lang],
    sana: formatDate(user.createdAt),
    darsliklar: stats.products,
    buyurtmalar: stats.orders,
    jami: formatSum(stats.totalPaid),
  });
  const on = await buttonSwitch("profile");
  const kb = new InlineKeyboard();
  if (on("change_phone")) kb.text(ctx.label("btn_change_phone"), CB.changePhone);
  if (on("notifications")) kb.text(ctx.label("btn_notifications"), CB.notifications());
  return { text, keyboard: await withScreenButtons(kb, ctx.lang, "profile") };
}

/** ⚙️ Sozlamalar: til va yangiliklar obunasi */
export async function settingsScreen(ctx: BotContext): Promise<Screen> {
  const user = ctx.user!;
  const text = await ctx.t("settings", {
    til: LANG_NAMES[ctx.lang],
    yangiliklar: await ctx.t(user.newsEnabled ? "news_on" : "news_off"),
  });
  const on = await buttonSwitch("settings");
  const kb = new InlineKeyboard();
  if (on("language")) kb.text(ctx.label("btn_language"), CB.language).row();
  if (on("news")) kb.text(ctx.label(user.newsEnabled ? "btn_news_toggle_off" : "btn_news_toggle_on"), CB.toggleNews);
  return { text, keyboard: await withScreenButtons(kb, ctx.lang, "settings", CB.profile) };
}

/** 🌐 Til tanlash — joriy til ✅ bilan */
export async function languageScreen(ctx: BotContext): Promise<Screen> {
  const kb = new InlineKeyboard();
  for (const lang of LANGS) kb.text(`${LANG_NAMES[lang]}${lang === ctx.lang ? " ✅" : ""}`, CB.setLang(lang)).row();
  return { text: await ctx.t("language_title"), keyboard: await withScreenButtons(kb, ctx.lang, "language", CB.settings) };
}

/**
 * 💬 Yordam: qisqa yo'riqnoma va support profiliga URL tugma (username — admin panel → Bot sozlamalari).
 * Username sozlanmagan bo'lsa yaroqsiz havola yasalmaydi. "Sozlanmagan" ogohlantirishi faqat standart
 * matnga qo'shiladi — admin o'z yordam matnini yozgan bo'lsa, aynan o'sha matn chiqadi.
 */
export async function helpScreen(ctx: BotContext): Promise<Screen> {
  const [url, help, customized] = await Promise.all([getSupportUrl(), ctx.t("help"), hasTextOverride(ctx.lang, "help")]);
  const text = url || customized ? help : joinParts([help, await ctx.t("support_not_configured")]);
  return { text, keyboard: await withScreenButtons(new InlineKeyboard(), ctx.lang, "help") };
}

const NOTIFICATION_ICON: Record<NotificationKind, string> = {
  info: "🔔",
  success: "✅",
  warning: "⚠️",
  order: "📦",
  message: "💬",
};

const NOTIFICATIONS_PAGE_SIZE = 5;

/** 🔔 Bildirishnomalar tarixi (sahifalangan) */
export async function notificationsScreen(ctx: BotContext, page = 1): Promise<Screen> {
  const user = ctx.user!;
  const { items, total } = await listNotifications(user.id, page, NOTIFICATIONS_PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE));
  const kb = new InlineKeyboard();
  if (total === 0) return { text: await ctx.t("notifications_empty"), keyboard: await withScreenButtons(kb, ctx.lang, "notifications", CB.profile) };

  const lines = items.map(
    (n) => `${NOTIFICATION_ICON[n.kind]} <i>${formatShortDateTime(n.createdAt)}</i>\n${escapeHtml(truncate(stripHtml(n.text).replace(/\s+/g, " "), 160))}`,
  );
  withPagination(kb, Math.min(page, pages), pages, CB.notifications);
  return { text: [await ctx.t("notifications_title"), "", lines.join("\n\n")].join("\n"), keyboard: await withScreenButtons(kb, ctx.lang, "notifications", CB.profile) };
}
