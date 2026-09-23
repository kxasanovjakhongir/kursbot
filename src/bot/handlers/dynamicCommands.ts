import { Composer } from "grammy";
import type { BotContext } from "../context";
import { findActiveCommand } from "../../services/botConfig";

/** Admin paneldagi buyruqlar: javob matni har safar bazadan olinadi */
export const dynamicCommands = new Composer<BotContext>();

dynamicCommands.chatType("private").on("message:text", async (ctx, next) => {
  const text = ctx.message.text;
  if (!text.startsWith("/")) return next();
  const name = text.slice(1).split(/[\s@]/)[0];
  const cmd = await findActiveCommand(name);
  if (!cmd) return next();
  await ctx.reply(cmd.response);
});
