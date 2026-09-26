import { Composer } from "grammy";
import type { BotContext } from "../context";
import { logger } from "../../lib/logger";
import { forgetChannel, rememberChannel } from "../../services/channels";

/** Bot kanalga admin qilinsa yoki chiqarilsa — ro'yxatni yangilaymiz (yopiq kanal havolasini ID ga moslash uchun) */
export const channelMembership = new Composer<BotContext>();

channelMembership.on("my_chat_member", async (ctx) => {
  const { chat, new_chat_member } = ctx.myChatMember;
  if (chat.type !== "channel") return;
  const id = String(chat.id);
  if (new_chat_member.status === "administrator") {
    await rememberChannel({ id, title: chat.title, ...(chat.username ? { username: chat.username } : {}) });
    logger.info({ channelId: id, title: chat.title }, "Bot kanalga admin qilindi");
  } else {
    await forgetChannel(id);
  }
});
