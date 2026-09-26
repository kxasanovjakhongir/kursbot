import { Composer, InlineKeyboard } from "grammy";
import type { Product, User } from "@prisma/client";
import type { BotContext } from "../context";
import { contactAdminKeyboard, mainMenu, phoneKeyboard, withNav } from "../keyboards";
import { cancelOrderConfirmScreen, catalogScreen, courseSectionScreen, orderCancelledScreen, paymentScreen, productScreen, type OrderWithProduct } from "../screens/catalog";
import { profileScreen } from "../screens/account";
import { purchasesScreen } from "../screens/purchases";
import { CB, COURSE_SECTIONS, ID_RE, PAGE_RE } from "../ui/callbacks";
import { render, renderLoading, renderNew } from "../ui/render";
import { allLabels } from "../../i18n";
import { parseStartPayload } from "../../lib/deeplink";
import { normalizePhone } from "../../lib/phone";
import { recordStart, setPhone, setLastProduct, displayName } from "../../services/users";
import { checkOwnership, getActiveProduct } from "../../services/products";
import { recordLinkVisit, resolveEntry } from "../../services/campaignLinks";
import { cancelOrder, createOrder } from "../../services/orders";
import { refreshInviteLink } from "../../services/access";
import { trackEvent } from "../../services/events";
import { getSettings } from "../../services/settings";
import { prisma } from "../../db";
import { config } from "../../config";
import { stripHtml } from "../../lib/format";

const CAPTION_LIMIT = 1024;

export const customer = new Composer<BotContext>();
const pm = customer.chatType("private");

function firstName(user: User): string {
  return user.firstName ?? displayName(user);
}

async function showCatalog(ctx: BotContext, page = 1): Promise<void> {
  await render(ctx, await catalogScreen(ctx, page));
}

async function askPhone(ctx: BotContext, product: Product | null): Promise<void> {
  const text = product
    ? await ctx.t("welcome_phone", { ism: firstName(ctx.user!), mahsulot: product.title })
    : await ctx.t("welcome_phone_generic", { ism: firstName(ctx.user!) });
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: phoneKeyboard(ctx.lang) });
}

/** Mahsulotni ko'rsatish: egalik tekshiruvi (BR-05) → telefon (5.2) → video (5.3) */
async function presentProduct(ctx: BotContext, product: Product): Promise<void> {
  const user = ctx.user!;
  await setLastProduct(user, product.code);

  const own = await checkOwnership(user.id, product);
  if (own.kind === "owned") {
    await render(ctx, {
      text: await ctx.t("already_owned"),
      keyboard: withNav(new InlineKeyboard().text(ctx.label("menu_purchases"), CB.purchases()), ctx.lang, CB.catalog()),
    });
    return;
  }
  if (own.kind === "partial") {
    // To'plam o'rniga faqat yetishmayotgan darslik taklif qilinadi (TZ 3.2). U sotuvdan olingan bo'lsa —
    // ko'rsatib bo'lmaydi (sotib olish tugmasi ishlamasdi), katalogga qaytariladi
    const missing = own.missing.find((p) => p.isActive && !p.deletedAt);
    if (!missing) {
      await ctx.reply(await ctx.t("error_not_found"));
      return showCatalog(ctx);
    }
    await ctx.reply(await ctx.t("bundle_partial"));
    return presentProduct(ctx, missing);
  }

  if (!user.phone) {
    await askPhone(ctx, product);
    return;
  }

  const screen = await productScreen(ctx, product);
  if (product.videoFileId) {
    // Telegram video izohi 1024 belgigacha: uzun tavsif bo'lsa — video alohida, matn tugmalar bilan keyin
    if (stripHtml(screen.text).length <= CAPTION_LIMIT) {
      await ctx.replyWithVideo(product.videoFileId, { caption: screen.text, parse_mode: "HTML", reply_markup: screen.keyboard });
    } else {
      await ctx.replyWithVideo(product.videoFileId);
      await renderNew(ctx, screen);
    }
  } else {
    await render(ctx, screen);
  }
  // "Kurs ko'rildi" (funnel bosqichi); link — qaysi reklama orqali
  await trackEvent(user.id, "product_view", { product: product.code, link: user.lastLinkId ?? null, via: "bot" });
}

/** Foydalanuvchining o'z buyurtmasi (boshqa odamning buyurtma raqamini yozib ko'rish befoyda) */
async function findOwnOrder(ctx: BotContext, orderId: string): Promise<OrderWithProduct | null> {
  return prisma.order.findFirst({ where: { id: BigInt(orderId), userId: ctx.user!.id }, include: { product: true } });
}

// ---------- 5.1. START va deep link ----------
pm.command("start", async (ctx) => {
  // Kampaniya linki (c7k2m9x), eski format (4b_instagram) yoki parametrsiz — baza orqali aniqlanadi
  const entry = await resolveEntry(ctx.match);
  const product = entry.kind === "product" ? entry.product : null;
  const link = entry.kind === "product" ? entry.link : null;
  const source = entry.kind === "product" ? entry.source : parseStartPayload(ctx.match).source;
  const user = await recordStart(ctx.user!, product?.code ?? null, source);
  ctx.user = user;
  if (link) await recordLinkVisit(user, link, "bot", ctx.isNewUser);
  await trackEvent(user.id, "start", { product: product?.code ?? null, source, link: link?.code ?? null, campaign: link?.campaign ?? null });

  if (product) {
    // Telefon bo'lmasa askPhone o'zi mahsulot nomi bilan salomlashadi
    if (link && user.phone) await ctx.reply(await ctx.t("link_welcome", { ism: firstName(user), mahsulot: product.title }), { parse_mode: "HTML" });
    return presentProduct(ctx, product);
  }
  // Noto'g'ri, o'chirilgan yoki eskirgan havola — tushuntirish va umumiy katalog
  if (entry.kind === "unavailable") await ctx.reply(await ctx.t("link_unavailable"));

  if (!user.phone) {
    await prisma.user.update({ where: { id: user.id }, data: { lastProduct: null } });
    await askPhone(ctx, null);
    return;
  }
  const reply_markup = mainMenu(ctx.lang, ctx.role);
  // Admin paneldagi "Welcome Message" sozlamasi ustun ({ism} qo'llab-quvvatlanadi)
  const { welcome_message } = await getSettings();
  const custom = welcome_message?.trim();
  if (custom) {
    await ctx.reply(custom.replace(/\{ism\}/g, firstName(user)), { reply_markup });
  } else {
    await ctx.reply(await ctx.t(ctx.isNewUser ? "welcome" : "welcome_back", { ism: firstName(user) }), { parse_mode: "HTML", reply_markup });
  }
  await showCatalog(ctx);
});

// ---------- 5.2. Telefon raqami ----------
pm.on("message:contact", async (ctx) => {
  const contact = ctx.message.contact;
  // Faqat o'z kontakti qabul qilinadi
  if (contact.user_id !== ctx.from.id) {
    await ctx.reply(await ctx.t("phone_own_only"), { parse_mode: "HTML", reply_markup: phoneKeyboard(ctx.lang, !!ctx.user!.phone) });
    return;
  }
  const hadPhone = !!ctx.user!.phone;
  const { phone, isForeign } = normalizePhone(contact.phone_number);
  const user = await setPhone(ctx.user!.id, phone, isForeign);
  ctx.user = user;
  await trackEvent(user.id, "phone", { foreign: isForeign, update: hadPhone });

  // Profildan raqamni yangilash
  if (hadPhone) {
    await ctx.reply(await ctx.t("phone_updated"), { reply_markup: mainMenu(ctx.lang, ctx.role) });
    await render(ctx, await profileScreen(ctx));
    return;
  }
  await ctx.reply(await ctx.t("phone_saved"), { reply_markup: mainMenu(ctx.lang, ctx.role) });
  const product = await getActiveProduct(user.lastProduct);
  if (product) await presentProduct(ctx, product);
  else await showCatalog(ctx);
});

// ---------- Darsliklar ----------
pm.hears(allLabels("menu_products"), async (ctx) => {
  if (!ctx.user!.phone) return askPhone(ctx, null);
  await showCatalog(ctx);
});

pm.callbackQuery(new RegExp(`^nav:cat:${PAGE_RE}$`), async (ctx) => {
  await showCatalog(ctx, Number(ctx.match[1]));
});

pm.callbackQuery(/^p:([\w-]{1,32})$/, async (ctx) => {
  const product = await getActiveProduct(ctx.match[1]);
  if (!product) {
    await ctx.answerCallbackQuery({ text: await ctx.t("error_not_found") });
    return showCatalog(ctx);
  }
  await presentProduct(ctx, product);
});

// Kurs bo'limlari: 📚 Kurs haqida · 💰 Narxi · 🎓 Dastur · 👨‍🏫 O'qituvchi
pm.callbackQuery(/^pi:([\w-]{1,32}):(about|price|program|teacher)$/, async (ctx) => {
  const product = await getActiveProduct(ctx.match[1]);
  const section = COURSE_SECTIONS.find((s) => s === ctx.match[2]);
  if (!product || !section) {
    await ctx.answerCallbackQuery({ text: await ctx.t("error_not_found") });
    return showCatalog(ctx);
  }
  await render(ctx, await courseSectionScreen(ctx, product, section));
  await trackEvent(ctx.user!.id, "course_section", { product: product.code, section });
});

// ---------- 5.4. "Darslikni olaman" ----------
pm.callbackQuery(/^buy:([\w-]{1,32})$/, async (ctx) => {
  const user = ctx.user!;
  const product = await getActiveProduct(ctx.match[1]);
  if (!product) {
    await ctx.answerCallbackQuery({ text: await ctx.t("error_not_found") });
    return showCatalog(ctx);
  }
  if (!user.phone) return askPhone(ctx, product);

  const own = await checkOwnership(user.id, product);
  if (own.kind !== "none") return presentProduct(ctx, product);

  const res = await createOrder(user.id, product, user.lastSource);
  if (res.kind === "no_card" || res.kind === "no_price") {
    await ctx.reply(await ctx.t("payment_unavailable"), { reply_markup: contactAdminKeyboard(ctx.lang) });
    return;
  }
  if (res.kind === "created") {
    await trackEvent(user.id, "order", { product: product.code, orderId: res.order.id.toString() });
  }
  // To'lov ma'lumoti alohida xabar — bank ilovasiga o'tib-qaytganda chatda turadi
  await renderNew(ctx, await paymentScreen(ctx, { ...res.order, product }));
});

pm.callbackQuery(new RegExp(`^pay:${ID_RE}$`), async (ctx) => {
  const order = await findOwnOrder(ctx, ctx.match[1]);
  if (!order || !["new", "rejected", "receipt_sent"].includes(order.status)) {
    await ctx.answerCallbackQuery({ text: await ctx.t("receipt_order_closed"), show_alert: true });
    return;
  }
  await render(ctx, await paymentScreen(ctx, order));
});

// ---------- Buyurtmani bekor qilish (tasdiqlash bilan) ----------
pm.callbackQuery(new RegExp(`^ord:cancel:${ID_RE}$`), async (ctx) => {
  const order = await findOwnOrder(ctx, ctx.match[1]);
  if (order?.status !== "new") {
    await ctx.answerCallbackQuery({ text: await ctx.t("order_cancel_failed"), show_alert: true });
    return;
  }
  await render(ctx, await cancelOrderConfirmScreen(ctx, order));
});

pm.callbackQuery(new RegExp(`^ord:cancel_ok:${ID_RE}$`), async (ctx) => {
  const orderId = BigInt(ctx.match[1]);
  const ok = await cancelOrder(ctx.user!.id, orderId);
  if (!ok) {
    await ctx.answerCallbackQuery({ text: await ctx.t("order_cancel_failed"), show_alert: true });
    return;
  }
  await trackEvent(ctx.user!.id, "order_cancelled", { orderId: orderId.toString() });
  await render(ctx, await orderCancelledScreen(ctx, orderId));
});

// ---------- 5.8. Mening xaridlarim ----------
const showPurchases = (page: number) => async (ctx: BotContext) => renderLoading(ctx, () => purchasesScreen(ctx, page));

pm.hears(allLabels("menu_purchases"), showPurchases(1));
pm.command("purchases", showPurchases(1));
// Eski xabarlardagi tugma
pm.callbackQuery("purchases", showPurchases(1));
pm.callbackQuery(new RegExp(`^nav:pur:${PAGE_RE}$`), (ctx) => showPurchases(Number(ctx.match[1]))(ctx));

pm.callbackQuery(new RegExp(`^link:${ID_RE}$`), async (ctx) => {
  // Telegram API chaqiruvi vaqt oladi — darhol "tayyorlanmoqda" deb javob beramiz
  await ctx.answerCallbackQuery({ text: await ctx.t("link_loading") });
  const grant = await refreshInviteLink(ctx.api, BigInt(ctx.match[1]), BigInt(ctx.from.id));
  if (!grant?.inviteLink) {
    await ctx.reply(await ctx.t("link_failed"), { reply_markup: contactAdminKeyboard(ctx.lang) });
    return;
  }
  await ctx.reply(await ctx.t("link_refreshed"), {
    reply_markup: new InlineKeyboard().url(ctx.label("btn_join", { mahsulot: grant.product.title }), grant.inviteLink),
  });
});

pm.callbackQuery(CB.resend, async (ctx) => {
  await ctx.reply(await ctx.t("resend_hint"));
});

pm.callbackQuery(CB.contact, async (ctx) => {
  const kontakt = config.SUPPORT_USERNAME ? `@${config.SUPPORT_USERNAME}` : await ctx.t("contact_admin_fallback");
  await ctx.reply(await ctx.t("contact_admin_hint", { kontakt }));
});
