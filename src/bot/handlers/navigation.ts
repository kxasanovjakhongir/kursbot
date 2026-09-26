import { Composer } from "grammy";
import type { BotContext } from "../context";
import { mainMenu, phoneKeyboard } from "../keyboards";
import { helpScreen, languageScreen, notificationsScreen, profileScreen, settingsScreen } from "../screens/account";
import { homeScreen } from "../screens/home";
import { CB, PAGE_RE } from "../ui/callbacks";
import { render, renderLoading } from "../ui/render";
import { allLabels, isLang, LANGS } from "../../i18n";
import { setLanguage, setNewsEnabled } from "../../services/users";
import { trackEvent } from "../../services/events";

/** Foydalanuvchi bo'limlari: bosh menyu, profil, sozlamalar, til, yordam, bildirishnomalar */
export const navigation = new Composer<BotContext>();
const pm = navigation.chatType("private");

export const showHome = async (ctx: BotContext) => render(ctx, await homeScreen(ctx));
export const showProfile = async (ctx: BotContext) => renderLoading(ctx, () => profileScreen(ctx));
export const showSettings = async (ctx: BotContext) => render(ctx, await settingsScreen(ctx));
export const showHelp = async (ctx: BotContext) => render(ctx, await helpScreen(ctx));

// Sahifa ko'rsatkichi va bo'sh tugmalar
navigation.callbackQuery(CB.noop, (ctx) => ctx.answerCallbackQuery());

pm.callbackQuery(CB.home, showHome);

// ---------- Profil ----------
pm.hears(allLabels("menu_profile"), showProfile);
pm.callbackQuery(CB.profile, showProfile);

pm.callbackQuery(CB.changePhone, async (ctx) => {
  await ctx.reply(await ctx.t("phone_update_prompt"), { reply_markup: phoneKeyboard(ctx.lang, true) });
});

// Reply-klaviaturadagi "❌ Bekor qilish" (masalan, raqam yangilashdan voz kechish)
pm.hears(allLabels("btn_cancel"), async (ctx) => {
  await ctx.reply(await ctx.t("action_cancelled"), { reply_markup: mainMenu(ctx.lang, ctx.role) });
});

pm.callbackQuery(new RegExp(`^nav:notif:${PAGE_RE}$`), async (ctx) => {
  await render(ctx, await notificationsScreen(ctx, Number(ctx.match[1])));
});

// ---------- Sozlamalar ----------
pm.hears(allLabels("menu_settings"), showSettings);
pm.callbackQuery(CB.settings, showSettings);
pm.callbackQuery(CB.language, async (ctx) => render(ctx, await languageScreen(ctx)));

pm.callbackQuery(new RegExp(`^set:lang:(${LANGS.join("|")})$`), async (ctx) => {
  const lang = ctx.match[1];
  if (!isLang(lang)) return;
  ctx.user = await setLanguage(ctx.user!.id, lang);
  ctx.lang = lang;
  await trackEvent(ctx.user.id, "language", { lang });
  await render(ctx, await settingsScreen(ctx));
  // Pastki menyu ham yangi tilda bo'lishi uchun yangi klaviatura yuboriladi
  await ctx.reply(await ctx.t("language_changed"), { reply_markup: mainMenu(ctx.lang, ctx.role) });
});

pm.callbackQuery(CB.toggleNews, async (ctx) => {
  ctx.user = await setNewsEnabled(ctx.user!.id, !ctx.user!.newsEnabled);
  await ctx.answerCallbackQuery({ text: await ctx.t(ctx.user.newsEnabled ? "news_on" : "news_off") });
  await render(ctx, await settingsScreen(ctx));
});

// ---------- Yordam ----------
pm.hears(allLabels("menu_help"), showHelp);
pm.callbackQuery(CB.help, showHelp);

/**
 * Standart buyruqlar. Admin panelda shu nomli buyruq yaratilsa, o'sha ustun turadi —
 * shuning uchun bu composer bazadagi buyruqlardan (dynamicCommands) keyin ulanadi.
 */
export const builtinCommands = new Composer<BotContext>();
const bc = builtinCommands.chatType("private");
bc.command(["menu", "home"], showHome);
bc.command("profile", showProfile);
bc.command("settings", showSettings);
bc.command("help", showHelp);
