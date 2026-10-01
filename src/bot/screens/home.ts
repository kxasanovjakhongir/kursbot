import { InlineKeyboard } from "grammy";
import type { BotContext } from "../context";
import { can } from "../../services/permissions";
import { CB } from "../ui/callbacks";
import type { Screen } from "../ui/render";

/** 🏠 Bosh menyu — barcha bo'limlarga bir bosishda o'tish */
export async function homeScreen(ctx: BotContext): Promise<Screen> {
  const kb = new InlineKeyboard()
    .text(ctx.label("menu_products"), CB.catalog())
    .text(ctx.label("menu_help"), CB.help);
  if (can(ctx.role, "orders.review")) kb.row().text(ctx.label("menu_admin"), CB.admin);
  return { text: await ctx.t("home_title"), keyboard: kb };
}
