import { Composer } from "grammy";
import type { BotContext } from "../context";
import { allLabels } from "../../i18n";
import { can, type Permission } from "../../services/permissions";
import { adminsListScreen } from "./adminsManage";
import {
  adminCardsScreen,
  adminHelpScreen,
  adminHomeScreen,
  adminProductsScreen,
  adminStatsScreen,
} from "../screens/admin";
import { CB } from "../ui/callbacks";
import { render, renderLoading, type Screen } from "../ui/render";

/** Bot ichidagi admin panel (inline). Har bir bo'lim ruxsat jadvali bo'yicha tekshiriladi */
export const adminMenu = new Composer<BotContext>();

function section(permission: Permission, build: (ctx: BotContext) => Promise<Screen>, loading = false) {
  return async (ctx: BotContext) => {
    if (!can(ctx.role, permission)) {
      await ctx.answerCallbackQuery({ text: await ctx.t("adm_no_permission"), show_alert: true });
      return;
    }
    if (loading) await renderLoading(ctx, () => build(ctx));
    else await render(ctx, await build(ctx));
  };
}

adminMenu.callbackQuery(CB.admin, section("orders.review", adminHomeScreen));
adminMenu.callbackQuery(CB.adminStats, section("stats.view", adminStatsScreen, true));
adminMenu.callbackQuery(CB.adminProducts, section("products.manage", adminProductsScreen, true));
adminMenu.callbackQuery(CB.adminCards, section("cards.manage", adminCardsScreen, true));
adminMenu.callbackQuery(CB.adminAdmins, section("admins.manage", adminsListScreen));
adminMenu.callbackQuery(CB.adminHelp, section("orders.review", adminHelpScreen));

// Pastki menyudagi "🛠 Admin panel" — faqat adminlarda ko'rinadi; boshqalar yozsa oddiy matn sifatida o'tadi
adminMenu
  .chatType("private")
  .filter((ctx) => can(ctx.role, "orders.review"))
  .hears(allLabels("menu_admin"), async (ctx) => render(ctx, await adminHomeScreen(ctx)));
