import { Composer, InlineKeyboard } from "grammy";
import type { BotContext } from "../context";
import { contactAdminKeyboard, productListKeyboard } from "../keyboards";
import { isWorkingTime } from "../../lib/format";
import { logger } from "../../lib/logger";
import { attachReceipt, createOrder, expireStaleOrders, listOpenOrders, setReceiptAdminMessage, type IncomingReceipt } from "../../services/orders";
import { checkOwnership, getActiveProduct, listActiveProducts } from "../../services/products";
import { getAdminGroupId, getSettings } from "../../services/settings";
import { trackEvent } from "../../services/events";
import { t } from "../../services/texts";
import { postReceiptCard } from "../admin/receiptCard";

export const receipt = new Composer<BotContext>();
const pm = receipt.chatType("private");

const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);

/**
 * Buyurtmasi aniqlanmagan chek vaqtincha shu yerda turadi, mijoz tugma bosguncha.
 * Yo'qolsa zarari yo'q — mijoz chekni qayta yuboradi.
 */
const stash = new Map<number, { file: IncomingReceipt; at: number }>();
const STASH_TTL = 30 * 60_000;

function takeStash(userTgId: number): IncomingReceipt | null {
  const s = stash.get(userTgId);
  stash.delete(userTgId);
  return s && Date.now() - s.at < STASH_TTL ? s.file : null;
}

async function submit(ctx: BotContext, orderId: bigint, file: IncomingReceipt): Promise<void> {
  const res = await attachReceipt(orderId, file);
  if (res.kind === "under_review") {
    await ctx.reply(await t("receipt_under_review"));
    return;
  }
  if (res.kind === "closed") {
    await ctx.reply(await t("receipt_order_closed"));
    return;
  }
  if (res.kind === "max_attempts") {
    // BR-04
    await ctx.reply(await t("receipt_max_attempts"), { reply_markup: contactAdminKeyboard() });
    return;
  }

  const settings = await getSettings();
  const working = isWorkingTime(new Date(), settings.work_start, settings.work_end);
  await ctx.reply(
    working ? await t("receipt_received") : await t("receipt_received_offhours", { ish_boshi: settings.work_start }),
  );
  await trackEvent(ctx.user!.id, "receipt", { orderId: orderId.toString(), attempt: res.order.attempts, duplicate: res.isDuplicate });

  const groupId = await getAdminGroupId();
  if (!groupId) {
    logger.error("ADMIN_GROUP_ID sozlanmagan — chek admin guruhiga yuborilmadi");
    return;
  }
  // Qayta urinishda oldingi chek xabariga reply qilinadi — admin ikkalasini birga ko'radi (BR-06)
  const replyTo =
    res.previous?.adminMessageId && res.previous.adminChatId === groupId ? Number(res.previous.adminMessageId) : undefined;
  const msg = await postReceiptCard(ctx.api, groupId, orderId, replyTo);
  await setReceiptAdminMessage(res.receipt.id, groupId, msg.message_id);
}

/** Chek qaysi buyurtmaga tegishli ekanini aniqlaydi (TZ 5.5) */
async function routeReceipt(ctx: BotContext, file: IncomingReceipt): Promise<void> {
  const user = ctx.user!;
  await expireStaleOrders(user.id);
  const open = (await listOpenOrders(user.id)).filter((o) => o.status !== "receipt_sent");

  if (open.length === 1) return submit(ctx, open[0].id, file);

  stash.set(ctx.from!.id, { file, at: Date.now() });
  if (open.length > 1) {
    const kb = new InlineKeyboard();
    for (const o of open) kb.text(`#${o.id} — ${o.product.title}`, `ro:${o.id}`).row();
    await ctx.reply(await t("receipt_which_order"), { reply_markup: kb });
    return;
  }

  const underReview = await listOpenOrders(user.id);
  if (underReview.length > 0) {
    stash.delete(ctx.from!.id);
    await ctx.reply(await t("receipt_under_review"));
    return;
  }
  // Ochiq buyurtma yo'q — qaysi mahsulot uchun ekanini so'raymiz
  const products = await listActiveProducts();
  await ctx.reply(await t("receipt_which_product"), { reply_markup: productListKeyboard(products, "rc") });
}

pm.on("message:photo", async (ctx) => {
  const photo = ctx.message.photo.at(-1)!;
  await routeReceipt(ctx, { fileId: photo.file_id, fileUniqueId: photo.file_unique_id, fileType: "photo" });
});

pm.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  const settings = await getSettings();
  if (!doc.mime_type || !ALLOWED_MIME.has(doc.mime_type)) {
    await ctx.reply(await t("receipt_invalid"));
    return;
  }
  if ((doc.file_size ?? 0) > settings.receipt_max_mb * 1024 * 1024) {
    await ctx.reply(await t("receipt_too_big", { mb: settings.receipt_max_mb }));
    return;
  }
  await routeReceipt(ctx, {
    fileId: doc.file_id,
    fileUniqueId: doc.file_unique_id,
    fileType: doc.mime_type === "application/pdf" ? "pdf" : "image",
  });
});

pm.callbackQuery(/^ro:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const file = takeStash(ctx.from.id);
  if (!file) return void (await ctx.reply(await t("resend_hint")));
  const order = (await listOpenOrders(ctx.user!.id)).find((o) => o.id === BigInt(ctx.match[1]));
  if (!order) return void (await ctx.reply(await t("receipt_order_closed")));
  await submit(ctx, order.id, file);
});

pm.callbackQuery(/^rc:([\w-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const file = takeStash(ctx.from.id);
  const user = ctx.user!;
  const product = await getActiveProduct(ctx.match[1]);
  if (!file || !product) return void (await ctx.reply(await t("resend_hint")));
  if (!user.phone) return void (await ctx.reply(await t("welcome_phone_generic", { ism: user.firstName ?? "" }), { parse_mode: "HTML" }));
  if ((await checkOwnership(user.id, product)).kind !== "none") return void (await ctx.reply(await t("already_owned")));

  const res = await createOrder(user.id, product, user.lastSource);
  if (res.kind === "no_card" || res.kind === "no_price") {
    await ctx.reply(await t("payment_unavailable"), { reply_markup: contactAdminKeyboard() });
    return;
  }
  if (res.kind === "created") await trackEvent(user.id, "order", { product: product.code, orderId: res.order.id.toString() });
  await submit(ctx, res.order.id, file);
});

// Chek o'rniga matn, stiker, ovoz, video — buyurtma statusi o'zgarmaydi (T-05)
pm.on(["message:sticker", "message:voice", "message:video", "message:video_note", "message:audio", "message:animation"], async (ctx) => {
  await ctx.reply(await t("receipt_invalid"));
});
