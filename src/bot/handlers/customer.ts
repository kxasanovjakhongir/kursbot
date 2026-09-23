import { Composer, InlineKeyboard } from "grammy";
import type { Order, Product, User } from "@prisma/client";
import type { BotContext } from "../context";
import { mainMenu, phoneKeyboard, productKeyboard, productListKeyboard, withAskButton, contactAdminKeyboard } from "../keyboards";
import { parseStartPayload } from "../../lib/deeplink";
import { normalizePhone } from "../../lib/phone";
import { escapeHtml, formatDateTime, formatMoney, formatSum, groupCard } from "../../lib/format";
import { recordStart, setLastProduct, setPhone } from "../../services/users";
import { checkOwnership, getActiveProduct, listActiveProducts } from "../../services/products";
import { createOrder, expireStaleOrders, listOpenOrders } from "../../services/orders";
import { listUserGrants, refreshInviteLink } from "../../services/access";
import { trackEvent } from "../../services/events";
import { DEFAULT_TEXTS as T, t } from "../../services/texts";
import { prisma } from "../../db";
import { config } from "../../config";

export const customer = new Composer<BotContext>();
const pm = customer.chatType("private");

function firstName(user: User): string {
  return user.firstName ?? "do'stim";
}

export async function showProductList(ctx: BotContext): Promise<void> {
  const products = await listActiveProducts();
  if (products.length === 0) {
    await ctx.reply(await t("no_products"), { reply_markup: mainMenu() });
    return;
  }
  await ctx.reply(await t("choose_product", { ism: firstName(ctx.user!) }), {
    parse_mode: "HTML",
    reply_markup: productListKeyboard(products),
  });
}

async function askPhone(ctx: BotContext, product: Product | null): Promise<void> {
  const text = product
    ? await t("welcome_phone", { ism: firstName(ctx.user!), mahsulot: product.title })
    : await t("welcome_phone_generic", { ism: firstName(ctx.user!) });
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: phoneKeyboard() });
}

function priceLine(product: Product): string {
  if (product.price <= 0) return "—";
  const now = `<b>${formatMoney(product.price)} so'm</b>`;
  return product.oldPrice && product.oldPrice > product.price ? `<s>${formatMoney(product.oldPrice)}</s> ${now}` : now;
}

/** Mahsulotni ko'rsatish: egalik tekshiruvi (BR-05) → telefon (5.2) → video (5.3) */
export async function presentProduct(ctx: BotContext, product: Product): Promise<void> {
  const user = ctx.user!;
  await setLastProduct(user.id, product.code);

  const own = await checkOwnership(user.id, product);
  if (own.kind === "owned") {
    await ctx.reply(await t("already_owned"), {
      reply_markup: new InlineKeyboard().text(T.menu_purchases, "purchases"),
    });
    return;
  }
  if (own.kind === "partial") {
    // To'plam o'rniga faqat yetishmayotgan darslik taklif qilinadi (TZ 3.2)
    await ctx.reply(await t("bundle_partial"));
    return presentProduct(ctx, own.missing[0]);
  }

  if (!user.phone) {
    await askPhone(ctx, product);
    return;
  }

  const caption = await t(
    "product_caption",
    { mahsulot: product.title, tavsif: product.description },
    { narx_qator: priceLine(product) },
  );
  const reply_markup = productKeyboard(product.code);
  if (product.videoFileId) {
    await ctx.replyWithVideo(product.videoFileId, { caption, parse_mode: "HTML", reply_markup });
  } else {
    await ctx.reply(caption, { parse_mode: "HTML", reply_markup });
  }
  await trackEvent(user.id, "video", { product: product.code });
}

export async function paymentText(order: Order & { product: Product }): Promise<string> {
  const card = order.cardId ? await prisma.card.findUnique({ where: { id: order.cardId } }) : null;
  let text = await t("payment_info", {
    raqam: order.id.toString(),
    summa: formatSum(order.amount),
    karta: card ? groupCard(card.number) : "—",
    karta_egasi: card ? `${card.holder}${card.bank ? ` (${card.bank})` : ""}` : "—",
    muddat: formatDateTime(order.expiresAt),
  });
  if (order.status === "rejected" && order.shortfall) {
    text += await t("payment_info_shortfall", { farq: formatSum(order.shortfall) });
  }
  return text;
}

export async function showPayment(ctx: BotContext, order: Order & { product: Product }): Promise<void> {
  if (order.status === "receipt_sent") {
    await ctx.reply(await t("payment_under_review", { raqam: order.id.toString() }));
    return;
  }
  // "Promo kodim bor" — 2-bosqich (TZ 5.4)
  const kb = withAskButton(new InlineKeyboard());
  await ctx.reply(await paymentText(order), {
    parse_mode: "HTML",
    reply_markup: kb.inline_keyboard.flat().length ? kb : undefined,
  });
}

// ---------- 5.1. START va deep link ----------
pm.command("start", async (ctx) => {
  const { productCode, source } = parseStartPayload(ctx.match);
  const user = await recordStart(ctx.user!, productCode, source);
  ctx.user = user;
  await trackEvent(user.id, "start", { product: productCode, source });

  const product = await getActiveProduct(productCode);
  if (!product) {
    // Parametrsiz yoki noto'g'ri kod — xato xabarisiz mahsulotlar ro'yxati
    if (!user.phone) {
      await setLastProductNull(user.id);
      await askPhone(ctx, null);
      return;
    }
    await ctx.reply("👋", { reply_markup: mainMenu() });
    await showProductList(ctx);
    return;
  }
  await presentProduct(ctx, product);
});

async function setLastProductNull(userId: bigint) {
  await prisma.user.update({ where: { id: userId }, data: { lastProduct: null } });
}

// ---------- 5.2. Telefon raqami ----------
pm.on("message:contact", async (ctx) => {
  const contact = ctx.message.contact;
  // Faqat o'z kontakti qabul qilinadi
  if (contact.user_id !== ctx.from.id) {
    await ctx.reply(await t("phone_own_only"), { parse_mode: "HTML", reply_markup: phoneKeyboard() });
    return;
  }
  const { phone, isForeign } = normalizePhone(contact.phone_number);
  const user = await setPhone(ctx.user!.id, phone, isForeign);
  ctx.user = user;
  await trackEvent(user.id, "phone", { foreign: isForeign });
  await ctx.reply(await t("phone_saved"), { reply_markup: mainMenu() });

  const product = await getActiveProduct(user.lastProduct);
  if (product) await presentProduct(ctx, product);
  else await showProductList(ctx);
});

// ---------- Asosiy menyu ----------
pm.hears(T.menu_products, async (ctx) => {
  if (!ctx.user!.phone) return askPhone(ctx, null);
  await showProductList(ctx);
});

pm.callbackQuery(/^p:([\w-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const product = await getActiveProduct(ctx.match[1]);
  if (!product) return showProductList(ctx);
  await presentProduct(ctx, product);
});

// ---------- 5.4. "Darslikni olaman" ----------
pm.callbackQuery(/^buy:([\w-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = ctx.user!;
  const product = await getActiveProduct(ctx.match[1]);
  if (!product) return showProductList(ctx);
  if (!user.phone) return askPhone(ctx, product);

  const own = await checkOwnership(user.id, product);
  if (own.kind !== "none") return presentProduct(ctx, product);

  const res = await createOrder(user.id, product, user.lastSource);
  if (res.kind === "no_card" || res.kind === "no_price") {
    await ctx.reply(await t("payment_unavailable"), { reply_markup: contactAdminKeyboard() });
    return;
  }
  if (res.kind === "created") {
    await trackEvent(user.id, "order", { product: product.code, orderId: res.order.id.toString() });
  }
  await showPayment(ctx, { ...res.order, product });
});

pm.callbackQuery(/^pay:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const order = await prisma.order.findFirst({
    where: { id: BigInt(ctx.match[1]), userId: ctx.user!.id },
    include: { product: true },
  });
  if (!order || !["new", "rejected", "receipt_sent"].includes(order.status)) {
    await ctx.reply(await t("receipt_order_closed"));
    return;
  }
  await showPayment(ctx, order);
});

// ---------- 5.8. Mening xaridlarim ----------
async function showPurchases(ctx: BotContext): Promise<void> {
  const user = ctx.user!;
  await expireStaleOrders(user.id);
  const grants = await listUserGrants(user.id);
  const open = await listOpenOrders(user.id);
  if (grants.length === 0 && open.length === 0) {
    await ctx.reply(await t("purchases_empty"), { reply_markup: mainMenu() });
    return;
  }
  const lines = [await t("purchases_header"), ""];
  const kb = new InlineKeyboard();
  for (const g of grants) {
    lines.push(`${g.joinedAt ? "✅" : "⏳"} ${escapeHtml(g.product.title)}${g.joinedAt ? "" : " — kanalga hali qo'shilmagansiz"}`);
    kb.text(`🔗 ${g.product.title}`, `link:${g.id}`).row();
  }
  const statusLabel: Record<string, string> = {
    new: "to'lov kutilmoqda",
    receipt_sent: "chek tekshirilmoqda",
    rejected: "chek rad etilgan",
  };
  for (const o of open) {
    lines.push(`🕒 #${o.id} ${escapeHtml(o.product.title)} — ${statusLabel[o.status] ?? o.status}`);
    if (o.status !== "receipt_sent") kb.text(`💳 #${o.id} to'lov ma'lumoti`, `pay:${o.id}`).row();
  }
  await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: kb });
}

pm.hears(T.menu_purchases, showPurchases);
pm.command("purchases", showPurchases);
pm.callbackQuery("purchases", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPurchases(ctx);
});

pm.callbackQuery(/^link:(\d+)$/, async (ctx) => {
  const grant = await refreshInviteLink(ctx.api, BigInt(ctx.match[1]), BigInt(ctx.from.id));
  if (!grant?.inviteLink) {
    await ctx.answerCallbackQuery({ text: "Linkni olib bo'lmadi, admin bilan bog'laning", show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
  await ctx.reply(await t("link_refreshed"), {
    reply_markup: new InlineKeyboard().url(
      await t("btn_join", { mahsulot: grant.product.title }),
      grant.inviteLink,
    ),
  });
});

pm.callbackQuery("resend", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(await t("resend_hint"));
});

pm.callbackQuery("contact", async (ctx) => {
  await ctx.answerCallbackQuery();
  const kontakt = config.SUPPORT_USERNAME ? `@${config.SUPPORT_USERNAME}` : "admin tez orada siz bilan bog'lanadi";
  await ctx.reply(await t("contact_admin_hint", { kontakt }));
});

