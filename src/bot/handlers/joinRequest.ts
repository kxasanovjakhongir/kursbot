import { Composer } from "grammy";
import type { BotContext } from "../context";
import { sendToAdminGroup, sendToUser } from "../notify";
import { escapeHtml } from "../../lib/format";
import { logger } from "../../lib/logger";
import { decideJoinRequest } from "../../services/access";
import { trackEvent } from "../../services/events";
import { t } from "../../services/texts";
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
  const product = await prisma.product.findFirst({ where: { channelId: BigInt(req.chat.id) } });
  if (!product) return;

  const decision = await decideJoinRequest(req.invite_link?.invite_link, BigInt(req.from.id));

  if (decision.kind === "approve") {
    await ctx.api.approveChatJoinRequest(req.chat.id, req.from.id);
    await trackEvent(decision.grant.userId, "joined", { product: decision.grant.product.code });
    await sendToUser(ctx.api, BigInt(req.from.id), await t("joined_welcome", { mahsulot: decision.grant.product.title }));
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
