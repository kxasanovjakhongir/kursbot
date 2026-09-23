import { Bot } from "grammy";
import type { BotContext } from "./context";
import { config } from "../config";
import { logger } from "../lib/logger";
import { getAdmin } from "../services/admins";
import { upsertUser } from "../services/users";
import { prisma } from "../db";
import { customer } from "./handlers/customer";
import { receipt } from "./handlers/receipt";
import { joinRequest } from "./handlers/joinRequest";
import { review } from "./admin/review";
import { adminCommands } from "./admin/commands";
import { mainMenu, phoneKeyboard } from "./keyboards";
import { alertTech, isBlockedError } from "./notify";
import { t } from "../services/texts";
import { listOpenOrders } from "../services/orders";

export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(config.BOT_TOKEN);

  // Foydalanuvchi va admin huquqi — har bir update da qayta aniqlanadi
  bot.use(async (ctx, next) => {
    ctx.user = null;
    ctx.admin = null;
    if (ctx.from && !ctx.from.is_bot) {
      ctx.admin = await getAdmin(ctx.from.id);
      if (ctx.admin && ctx.admin.name !== ctx.from.first_name) {
        ctx.admin = await prisma.admin.update({ where: { id: ctx.admin.id }, data: { name: ctx.from.first_name } });
      }
      if (ctx.chat?.type === "private") ctx.user = await upsertUser(ctx.from);
    }
    await next();
  });

  // Tartib muhim: admin buyruqlari va tugmalari mijoz oqimidan oldin
  bot.use(adminCommands);
  bot.use(review);
  bot.use(joinRequest);
  bot.use(customer);
  bot.use(receipt);

  // Qolgan matnlar (shaxsiy chat)
  bot.chatType("private").on("message:text", async (ctx) => {
    const user = ctx.user!;
    if (!user.phone) {
      // Qo'lda yozilgan raqam qabul qilinmaydi (TZ 5.2)
      await ctx.reply(await t("phone_own_only"), { parse_mode: "HTML", reply_markup: phoneKeyboard() });
      return;
    }
    const open = await listOpenOrders(user.id);
    if (open.some((o) => o.status === "new" || o.status === "rejected")) {
      await ctx.reply(await t("receipt_invalid"));
      return;
    }
    // 2-bosqich: "Savol berish" — support yozishma (TZ 7.4)
    await ctx.reply(await t("choose_product", { ism: user.firstName ?? "" }), { parse_mode: "HTML", reply_markup: mainMenu() });
  });

  bot.catch(async (err) => {
    if (isBlockedError(err.error)) return;
    logger.error({ err: err.error, update: err.ctx.update.update_id }, "bot xatosi");
    await alertTech(err.ctx.api, String((err.error as Error)?.stack ?? err.error));
  });

  return bot;
}
