import { Composer, InlineKeyboard } from "grammy";
import type { Product, User } from "@prisma/client";
import type { BotContext } from "../context";
import { contactAdminKeyboard, mainMenu, phoneKeyboard } from "../keyboards";
import { cancelOrderConfirmScreen, catalogScreen, courseSectionScreen, orderCancelledScreen, paymentScreen, productScreen, type OrderWithProduct } from "../screens/catalog";
import { profileScreen } from "../screens/account";
import { lockedLessonsScreen, ownedCourseScreen } from "../screens/lessons";
import { CB, COURSE_SECTIONS, ID_RE, PAGE_RE } from "../ui/callbacks";
import { render, renderNew } from "../ui/render";
import { allLabels, joinParts } from "../../i18n";
import { parseStartPayload } from "../../lib/deeplink";
import { normalizePhone } from "../../lib/phone";
import { recordStart, setPhone, setLastProduct, displayName, markBlocked } from "../../services/users";
import { hasCourseAccess, isBlockedError, isUnavailableFileError, lessonPosition, sendLesson } from "../../services/lessons";
import { checkOwnership, getActiveProduct, getViewableProduct } from "../../services/products";
import { recordLinkVisit, resolveEntry } from "../../services/campaignLinks";
import { applyCurrentPrice, cancelOrder, createOrder } from "../../services/orders";
import { rememberPaymentScreen } from "../lastPayment";
import { refreshInviteLink } from "../../services/access";
import { trackEvent } from "../../services/events";
import { crmCourseName, sendCourseToCrm, sendLeadToCrm } from "../../services/crm";
import { displayCourseName, getSettings, getSupportPhone, getSupportUrl } from "../../services/settings";
import { prisma } from "../../db";
import { TtlMap } from "../../lib/ttlMap";

export const customer = new Composer<BotContext>();
const pm = customer.chatType("private");

/** Video izohidagi aloqa: sozlamalardagi raqam, bo'lmasa Telegram yordam profili */
async function contactForCaption(): Promise<string> {
  const phone = await getSupportPhone();
  if (phone) return phone;
  const url = await getSupportUrl();
  return url ? `@${url.slice("https://t.me/".length)}` : "";
}

function firstName(user: User): string {
  return user.firstName ?? displayName(user);
}

async function showCatalog(ctx: BotContext, page = 1): Promise<void> {
  await render(ctx, await catalogScreen(ctx, page));
}

async function askPhone(ctx: BotContext, product: Product | null): Promise<void> {
  const text = product
    ? await ctx.t("welcome_phone", { ism: firstName(ctx.user!), mahsulot: await displayCourseName(product.title) })
    : await ctx.t("welcome_phone_generic", { ism: firstName(ctx.user!) });
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: phoneKeyboard(ctx.lang) });
}

/** Mahsulotni ko'rsatish: egalik tekshiruvi (BR-05) → telefon (5.2) → video (5.3) */
async function presentProduct(ctx: BotContext, product: Product): Promise<void> {
  const user = ctx.user!;
  await setLastProduct(user, product.code);
  // Ro'yxatdan o'tgan (lidi CRM'da bor) mijoz yo'nalishni tanladi — CRM'ga (o'sha yo'nalish qayta yuborilmaydi)
  if (user.phone) void sendCourseToCrm(user, product.title);

  const own = await checkOwnership(user.id, product);
  if (own.kind === "owned") {
    // Xarid qilingan kurs: darslar (videolar) va kanal havolasi
    await render(ctx, await ownedCourseScreen(ctx, product));
    return;
  }
  if (own.kind === "partial") {
    // To'plam o'rniga faqat yetishmayotgan darslik taklif qilinadi (TZ 3.2). U sotuvdan olingan bo'lsa —
    // ko'rsatib bo'lmaydi (sotib olish tugmasi ishlamasdi), katalogga qaytariladi
    const missing = own.missing.find((p) => p.isActive && !p.deletedAt);
    if (!missing) {
      await ctx.reply(await ctx.t("error_not_found"), { parse_mode: "HTML" });
      return showCatalog(ctx);
    }
    await ctx.reply(await ctx.t("bundle_partial"), { parse_mode: "HTML" });
    return presentProduct(ctx, missing);
  }

  if (!user.phone) {
    await askPhone(ctx, product);
    return;
  }

  let videoSent = false;
  if (product.videoFileId) {
    // Faqat tanishtiruv videosi: narx kartochkasi yuborilmaydi — izohda «batafsil ma'lumot uchun shu raqamga» ({telefon})
    const vars = { mahsulot: await displayCourseName(product.title), telefon: await contactForCaption() };
    try {
      await ctx.replyWithVideo(product.videoFileId, {
        // Sarlavha + paneldan tahrirlanadigan tanishtiruv matni
        caption: joinParts([await ctx.t("intro_video_title", vars), await ctx.t("intro_video_text", vars)]) || undefined,
        parse_mode: "HTML",
        supports_streaming: true,
      });
      videoSent = true;
    } catch (err) {
      // Video Telegram'da topilmasa — odam bo'sh qolmasin: kurs kartochkasi
      if (!isUnavailableFileError(err)) throw err;
      ctx.log.error({ err, product: product.code }, "tanishtiruv videosi yuborilmadi (file_id yaroqsiz)");
    }
  }
  if (!videoSent) await render(ctx, await productScreen(ctx, product));
  // "Kurs ko'rildi" (funnel bosqichi); link — qaysi reklama orqali
  await trackEvent(user.id, "product_view", { product: product.code, link: user.lastLinkId ?? null, via: "bot" });
}

/** Foydalanuvchining o'z buyurtmasi (boshqa odamning buyurtma raqamini yozib ko'rish befoyda) */
async function findOwnOrder(ctx: BotContext, orderId: string): Promise<OrderWithProduct | null> {
  return prisma.order.findFirst({ where: { id: BigInt(orderId), userId: ctx.user!.id }, include: { product: true } });
}

// ---------- 5.1. START va deep link ----------
/**
 * To'lov havolasi: t.me/<bot>?start=tolov-<kurs kodi>. Sotuvchi mijozga yuboradi — bot darhol Payme / Click
 * tugmalari bor to'lov oynasini ochadi (buyurtma shu odamga bog'lanadi, to'lansa kanal avtomatik ochiladi).
 */
const PAY_LINK_RE = /^tolov-([A-Za-z0-9_]{1,32})$/;
/** Telefon so'ralgan paytda qaysi kurs to'lovi kutilyapti (raqam yuborilgach to'lov oynasi ochiladi) */
const pendingPurchase = new TtlMap<number, string>(60 * 60_000, 10_000);

/** "Darslikni olaman": buyurtma (yoki ochiq turgani) va to'lov oynasi */
async function startPurchase(ctx: BotContext, product: Product): Promise<void> {
  const user = ctx.user!;
  if (!user.phone) {
    pendingPurchase.set(Number(user.telegramId), product.code);
    return askPhone(ctx, product);
  }

  const own = await checkOwnership(user.id, product);
  if (own.kind !== "none") return presentProduct(ctx, product);

  const res = await createOrder(user.id, product, user.lastSource);
  if (res.kind === "no_card" || res.kind === "no_price") {
    await ctx.reply(await ctx.t("payment_unavailable"), { parse_mode: "HTML", reply_markup: await contactAdminKeyboard(ctx.lang) });
    return;
  }
  if (res.kind === "created") {
    await trackEvent(user.id, "order", { product: product.code, orderId: res.order.id.toString() });
  }
  await rememberPaymentScreen(Number(user.telegramId), res.order.id);
  // To'lov ma'lumoti alohida xabar — bank ilovasiga o'tib-qaytganda chatda turadi
  await renderNew(ctx, await paymentScreen(ctx, { ...res.order, product }));
}

pm.command("start", async (ctx) => {
  const payLink = PAY_LINK_RE.exec(ctx.match?.trim() ?? "");
  if (payLink) {
    const product = await getActiveProduct(payLink[1].toLowerCase());
    if (product) {
      const user = await recordStart(ctx.user!, product.code, "tolov_link");
      ctx.user = user;
      await trackEvent(user.id, "start", { product: product.code, source: "tolov_link", link: null, campaign: null, method: null });
      await setLastProduct(user, product.code);
      if (user.phone) void sendCourseToCrm(user, product.title);
      return startPurchase(ctx, product);
    }
  }
  // Kampaniya linki (c7k2m9x), eski format (4b_instagram) yoki parametrsiz — baza orqali aniqlanadi
  const entry = await resolveEntry(ctx.match);
  const product = entry.kind === "product" ? entry.product : null;
  const link = entry.kind === "product" ? entry.link : null;
  const source = entry.kind === "product" ? entry.source : parseStartPayload(ctx.match).source;
  const user = await recordStart(ctx.user!, product?.code ?? null, source);
  ctx.user = user;
  if (link) await recordLinkVisit(user, link, "bot", ctx.isNewUser);
  // method — tracking sahifasi Telegramni qaysi usul bilan ochgani (qaysi usul ishlashini o'lchash uchun)
  const method = entry.kind === "product" ? (entry.method ?? null) : null;
  await trackEvent(user.id, "start", { product: product?.code ?? null, source, link: link?.code ?? null, campaign: link?.campaign ?? null, method });

  if (product) {
    // Telefon bo'lmasa askPhone o'zi mahsulot nomi bilan salomlashadi
    if (link && user.phone) await ctx.reply(await ctx.t("link_welcome", { ism: firstName(user), mahsulot: await displayCourseName(product.title) }), { parse_mode: "HTML" });
    return presentProduct(ctx, product);
  }
  // Noto'g'ri, o'chirilgan yoki eskirgan havola — tushuntirish va umumiy katalog
  if (entry.kind === "unavailable") await ctx.reply(await ctx.t("link_unavailable"), { parse_mode: "HTML" });

  if (!user.phone) {
    // Reklamadan kelib (/start <kod>) raqam bermagan odam keyin oddiy /start bossa (Telegram ko'pincha 1–2 soniyada
    // ikkinchi bo'sh /start yuboradi) — kurs eslab qolinadi: raqam yuborilishi bilan o'sha kurs videosi ketadi.
    // Ilgari bu yerda kurs o'chirilardi va odam video o'rniga katalog olardi.
    const pending = entry.kind === "unavailable" ? null : await getActiveProduct(user.lastProduct);
    if (!pending && user.lastProduct !== null) ctx.user = await prisma.user.update({ where: { id: user.id }, data: { lastProduct: null } });
    await askPhone(ctx, pending);
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
  // CRM'ga lid (fon rejimida — CRM sekin yoki ishlamasa ham foydalanuvchi kutmaydi), qaysi kurs orqali kelgani bilan
  const product = await getActiveProduct(user.lastProduct);
  void sendLeadToCrm(user, { yonalish: product ? crmCourseName(product.title) : null });

  // Profildan raqamni yangilash
  if (hadPhone) {
    await ctx.reply(await ctx.t("phone_updated"), { parse_mode: "HTML", reply_markup: mainMenu(ctx.lang, ctx.role) });
    await render(ctx, await profileScreen(ctx));
    return;
  }
  await ctx.reply(await ctx.t("phone_saved"), { parse_mode: "HTML", reply_markup: mainMenu(ctx.lang, ctx.role) });
  // To'lov havolasi orqali kelgan — darhol to'lov oynasi
  if (product && pendingPurchase.take(ctx.from.id) === product.code) await startPurchase(ctx, product);
  else if (product) await presentProduct(ctx, product);
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
  const product = await getViewableProduct(ctx.match[1], ctx.user!.id);
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

// ---------- Kurs darslari (videolar) ----------
pm.callbackQuery(new RegExp(`^ls:([\\w-]{1,32}):${PAGE_RE}$`), async (ctx) => {
  const product = await getViewableProduct(ctx.match[1], ctx.user!.id);
  if (!product) {
    await ctx.answerCallbackQuery({ text: await ctx.t("error_not_found") });
    return showCatalog(ctx);
  }
  const page = Number(ctx.match[2]);
  const own = await checkOwnership(ctx.user!.id, product);
  await render(ctx, own.kind === "owned" ? await ownedCourseScreen(ctx, product, page) : await lockedLessonsScreen(ctx, product, page));
});

pm.callbackQuery(/^l:(\d{1,9})$/, async (ctx) => {
  const lesson = await prisma.lesson.findUnique({ where: { id: Number(ctx.match[1]) } });
  if (!lesson) {
    await ctx.answerCallbackQuery({ text: await ctx.t("error_not_found"), show_alert: true });
    return;
  }
  // Faqat shu kursga faol kirishi bor xaridor (IDOR: dars ID sini qo'lda yuborish ham tekshiriladi)
  if (!(await hasCourseAccess(ctx.user!.id, lesson.productId))) {
    await ctx.answerCallbackQuery({ text: await ctx.t("lesson_locked"), show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery({ text: await ctx.t("lesson_sending") });
  try {
    await sendLesson(ctx.api, ctx.from.id, lesson, await lessonPosition(lesson));
  } catch (err) {
    if (isBlockedError(err)) return markBlocked(BigInt(ctx.from.id));
    if (isUnavailableFileError(err)) {
      await ctx.reply(await ctx.t("lesson_unavailable"), { parse_mode: "HTML", reply_markup: await contactAdminKeyboard(ctx.lang) });
      return;
    }
    throw err; // errorBoundary: log + foydalanuvchiga umumiy xabar
  }
  await trackEvent(ctx.user!.id, "lesson_view", { lessonId: lesson.id, productId: lesson.productId });
});

// ---------- 5.4. "Darslikni olaman" ----------
pm.callbackQuery(/^buy:([\w-]{1,32})$/, async (ctx) => {
  const product = await getActiveProduct(ctx.match[1]);
  if (!product) {
    await ctx.answerCallbackQuery({ text: await ctx.t("error_not_found") });
    return showCatalog(ctx);
  }
  await startPurchase(ctx, product);
});

pm.callbackQuery(new RegExp(`^pay:${ID_RE}$`), async (ctx) => {
  const order = await findOwnOrder(ctx, ctx.match[1]);
  if (!order || !["new", "rejected", "receipt_sent"].includes(order.status)) {
    await ctx.answerCallbackQuery({ text: await ctx.t("receipt_order_closed"), show_alert: true });
    return;
  }
  await rememberPaymentScreen(ctx.from.id, order.id);
  await render(ctx, await paymentScreen(ctx, await applyCurrentPrice(order, order.product)));
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

// ---------- Kanal havolasini qayta olish (kurs sahifasidagi «🔗 Kanal havolasi») ----------
pm.callbackQuery(new RegExp(`^link:${ID_RE}$`), async (ctx) => {
  // Telegram API chaqiruvi vaqt oladi — darhol "tayyorlanmoqda" deb javob beramiz
  await ctx.answerCallbackQuery({ text: await ctx.t("link_loading") });
  const grant = await refreshInviteLink(ctx.api, BigInt(ctx.match[1]), BigInt(ctx.from.id));
  if (!grant?.inviteLink) {
    await ctx.reply(await ctx.t("link_failed"), { parse_mode: "HTML", reply_markup: await contactAdminKeyboard(ctx.lang) });
    return;
  }
  await ctx.reply(await ctx.t("link_refreshed"), { parse_mode: "HTML",
    reply_markup: new InlineKeyboard().url(ctx.label("btn_join", { mahsulot: await displayCourseName(grant.product.title) }), grant.inviteLink),
  });
});

pm.callbackQuery(CB.resend, async (ctx) => {
  await ctx.reply(await ctx.t("resend_hint"), { parse_mode: "HTML" });
});

pm.callbackQuery(CB.contact, async (ctx) => {
  const url = await getSupportUrl();
  if (!url) {
    await ctx.reply(await ctx.t("support_not_configured"), { parse_mode: "HTML" });
    return;
  }
  await ctx.reply(await ctx.t("contact_admin_hint", { kontakt: `@${url.slice("https://t.me/".length)}` }), {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().url(ctx.label("btn_contact_admin"), url),
  });
});
