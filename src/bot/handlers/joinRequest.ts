import { Composer, GrammyError } from "grammy";
import type { BotContext } from "../context";
import { notifyUser, sendToAdminGroup } from "../notify";
import { escapeHtml } from "../../lib/format";
import { displayCourseName } from "../../services/settings";
import { logger } from "../../lib/logger";
import { decideJoinRequest } from "../../services/access";
import { trackEvent } from "../../services/events";
import { translate } from "../../i18n";
import { userLang } from "../../services/users";
import { prisma } from "../../db";

export const joinRequest = new Composer<BotContext>();

const REASON_LABEL = {
  unknown_link: "to'lovsiz yoki begona link orqali",
  foreign_user: "boshqa odamning shaxsiy linki orqali",
  revoked: "kirish huquqi bekor qilingan",
  expired: "kirish muddati tugagan",
} as const;

joinRequest.on("chat_join_request", async (ctx) => {
  const req = ctx.chatJoinRequest;
  // Faqat mahsulot kanallariga tegishli so'rovlar
  const product = await prisma.product.findFirst({
    where: { channelId: BigInt(req.chat.id) },
    // Kanal o'chirilgan kursdan yangisiga o'tgan bo'lsa — amaldagisi
    orderBy: { deletedAt: { sort: "asc", nulls: "first" } },
  });
  if (!product) return;

  const decision = await decideJoinRequest(req.invite_link?.invite_link, BigInt(req.from.id));

  if (decision.kind === "approve") {
    try {
      await ctx.api.approveChatJoinRequest(req.chat.id, req.from.id);
    } catch (err) {
      // Allaqachon a'zo yoki so'rov eskirgan — zararsiz; boshqa xato (bot huquqi) — adminlarga ma'lum qilinadi
      const desc = err instanceof GrammyError ? err.description : "";
      if (!/USER_ALREADY_PARTICIPANT|HIDE_REQUESTER_MISSING/i.test(desc)) {
        logger.error({ err, chatId: req.chat.id, userId: req.from.id }, "qo'shilish so'rovi tasdiqlanmadi");
        await sendToAdminGroup(
          ctx.api,
          `⚠️ ${escapeHtml(product.title)}: to'lagan mijozning (<code>${req.from.id}</code>) kanalga qo'shilish so'rovi tasdiqlanmadi. Bot kanalda admin va «a'zolarni qo'shish» huquqi borligini tekshiring.`,
        ).catch(() => undefined);
        return;
      }
    }
    await trackEvent(decision.grant.userId, "joined", { product: decision.grant.product.code });
    const { user, product: joined } = decision.grant;
    const text = await translate(await userLang(user), "joined_welcome", { mahsulot: await displayCourseName(joined.title) });
    await notifyUser(ctx.api, user, "success", text);
    // 2-bosqich: instrument fayllari shu yerda yuboriladi (TZ 5.9, BR-23)
    return;
  }

  // BR-15, BR-16: begona odam rad etiladi va hodisa loglanadi
  await ctx.api.declineChatJoinRequest(req.chat.id, req.from.id).catch((err) => logger.warn({ err }, "decline xatosi"));
  await trackEvent(null, "join_declined", {
    chatId: req.chat.id,
    fromId: req.from.id,
    reason: decision.reason,
    grantId: decision.grant?.id.toString() ?? null,
  });
  const who = [escapeHtml(req.from.first_name), req.from.username ? `@${escapeHtml(req.from.username)}` : null, `<code>${req.from.id}</code>`]
    .filter(Boolean)
    .join(", ");
  const owner = decision.grant ? ` Link egasi: buyurtma #${decision.grant.orderId}.` : "";
  await sendToAdminGroup(
    ctx.api,
    `🚫 Begona odam kanalga kirmoqchi bo'ldi — rad etildi.\nKanal: ${escapeHtml(product.title)}\nKim: ${who}\nSabab: ${REASON_LABEL[decision.reason]}.${owner}`,
  );
});
