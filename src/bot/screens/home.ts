import { InlineKeyboard } from "grammy";
import type { BotContext } from "../context";
import { withScreenButtons } from "../keyboards";
import { can } from "../../services/permissions";
import { CB } from "../ui/callbacks";
import type { Screen } from "../ui/render";

/** 🏠 Bosh menyu — barcha bo'limlarga bir bosishda o'tish */
export async function homeScreen(ctx: BotContext): Promise<Screen> {
  const kb = await withScreenButtons(new InlineKeyboard(), ctx.lang, "home");
  if (can(ctx.role, "orders.review")) kb.row().text(ctx.label("menu_admin"), CB.admin);
  return { text: await ctx.t("home_title"), keyboard: kb };
}
