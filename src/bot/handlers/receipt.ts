import { Composer, InlineKeyboard } from "grammy";
import type { BotContext } from "../context";
import { contactAdminKeyboard, phoneKeyboard, productListKeyboard } from "../keyboards";
import { createOrder, expireStaleOrders, listOpenOrders, type IncomingReceipt } from "../../services/orders";
import { checkOwnership, getActiveProduct, listActiveProducts } from "../../services/products";
import { getSettings } from "../../services/settings";
import { trackEvent } from "../../services/events";
import { z } from "zod";
import { SharedState } from "../../services/sharedState";
import { forwardReceiptToAdmins, submitReceipt } from "../receiptFlow";
import { ID_RE } from "../ui/callbacks";

export const receipt = new Composer<BotContext>();
const pm = receipt.chatType("private");

export const RECEIPT_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);

/**
 * Buyurtmasi aniqlanmagan chek vaqtincha shu yerda turadi, mijoz tugma bosguncha.
 * Bazada (barcha instanslar uchun umumiy); yo'qolsa zarari yo'q — mijoz chekni qayta yuboradi.
 */
const stash = new SharedState(
  "receipt",
  30 * 60_000,
  z.object({ fileId: z.string(), fileUniqueId: z.string(), fileType: z.enum(["photo", "image", "pdf"]) }),
);

async function submit(ctx: BotContext, orderId: bigint, file: IncomingReceipt): Promise<void> {
  const res = await submitReceipt(ctx.user!.id, orderId, file);
  if (res.kind === "under_review") {
    await ctx.reply(await ctx.t("receipt_under_review"));
    return;
  }
  if (res.kind === "closed") {
    await ctx.reply(await ctx.t("receipt_order_closed"));
    return;
  }
  if (res.kind === "max_attempts") {
    // BR-04
    await ctx.reply(await ctx.t("receipt_max_attempts"), { reply_markup: contactAdminKeyboard(ctx.lang) });
    return;
  }
  await ctx.reply(res.working ? await ctx.t("receipt_received") : await ctx.t("receipt_received_offhours", { ish_boshi: res.workStart }));
  await forwardReceiptToAdmins(ctx.api, res);
}

/** Chek qaysi buyurtmaga tegishli ekanini aniqlaydi (TZ 5.5) */
async function routeReceipt(ctx: BotContext, file: IncomingReceipt): Promise<void> {
  const user = ctx.user!;
  await expireStaleOrders(user.id);
  const open = (await listOpenOrders(user.id)).filter((o) => o.status !== "receipt_sent");

  if (open.length === 1) return submit(ctx, open[0].id, file);

  await stash.set(ctx.from!.id, file);
  if (open.length > 1) {
    const kb = new InlineKeyboard();
    for (const o of open) kb.text(`#${o.id} — ${o.product.title}`, `ro:${o.id}`).row();
    await ctx.reply(await ctx.t("receipt_which_order"), { reply_markup: kb });
    return;
  }

  const underReview = await listOpenOrders(user.id);
  if (underReview.length > 0) {
    await stash.delete(ctx.from!.id);
    await ctx.reply(await ctx.t("receipt_under_review"));
    return;
  }
  // Ochiq buyurtma yo'q — qaysi mahsulot uchun ekanini so'raymiz
  const products = await listActiveProducts();
  await ctx.reply(await ctx.t("receipt_which_product"), { reply_markup: productListKeyboard(products, "rc") });
}

pm.on("message:photo", async (ctx) => {
  const photo = ctx.message.photo.at(-1)!;
  await routeReceipt(ctx, { fileId: photo.file_id, fileUniqueId: photo.file_unique_id, fileType: "photo" });
});

pm.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  const settings = await getSettings();
  if (!doc.mime_type || !RECEIPT_MIME.has(doc.mime_type)) {
    await ctx.reply(await ctx.t("receipt_invalid"));
    return;
  }
  if ((doc.file_size ?? 0) > settings.receipt_max_mb * 1024 * 1024) {
    await ctx.reply(await ctx.t("receipt_too_big", { mb: settings.receipt_max_mb }));
    return;
  }
  await routeReceipt(ctx, {
    fileId: doc.file_id,
    fileUniqueId: doc.file_unique_id,
    fileType: doc.mime_type === "application/pdf" ? "pdf" : "image",
  });
});

pm.callbackQuery(new RegExp(`^ro:${ID_RE}$`), async (ctx) => {
  const file = await stash.take(ctx.from.id);
  if (!file) return void (await ctx.reply(await ctx.t("resend_hint")));
  const order = (await listOpenOrders(ctx.user!.id)).find((o) => o.id === BigInt(ctx.match[1]));
  if (!order) return void (await ctx.reply(await ctx.t("receipt_order_closed")));
  await submit(ctx, order.id, file);
});

pm.callbackQuery(/^rc:([\w-]{1,32})$/, async (ctx) => {
  const file = await stash.take(ctx.from.id);
  const user = ctx.user!;
  const product = await getActiveProduct(ctx.match[1]);
  if (!file || !product) return void (await ctx.reply(await ctx.t("resend_hint")));
  if (!user.phone) {
    // Chek saqlanmaydi (telefonsiz buyurtma yo'q) — raqam yuborish tugmasi bilan so'raladi, keyin chek qayta yuboriladi
    return void (await ctx.reply(await ctx.t("welcome_phone_generic", { ism: user.firstName ?? "" }), { parse_mode: "HTML", reply_markup: phoneKeyboard(ctx.lang) }));
  }
  if ((await checkOwnership(user.id, product)).kind !== "none") return void (await ctx.reply(await ctx.t("already_owned")));

  const res = await createOrder(user.id, product, user.lastSource);
  if (res.kind === "no_card" || res.kind === "no_price") {
    await ctx.reply(await ctx.t("payment_unavailable"), { reply_markup: contactAdminKeyboard(ctx.lang) });
    return;
  }
  if (res.kind === "created") await trackEvent(user.id, "order", { product: product.code, orderId: res.order.id.toString() });
  await submit(ctx, res.order.id, file);
});

// Chek o'rniga matn, stiker, ovoz, video — buyurtma statusi o'zgarmaydi (T-05)
pm.on(["message:sticker", "message:voice", "message:video", "message:video_note", "message:audio", "message:animation"], async (ctx) => {
  await ctx.reply(await ctx.t("receipt_invalid"));
});
