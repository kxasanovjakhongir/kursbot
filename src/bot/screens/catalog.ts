import { InlineKeyboard } from "grammy";
import type { Order, Product } from "@prisma/client";
import type { BotContext } from "../context";
import { webAppUrl, withAskButton, withNav, withPagination, withWebAppButton } from "../keyboards";
import { escapeHtml, formatDate, formatDateTime, formatMoney, formatSum, groupCard } from "../../lib/format";
import { prisma } from "../../db";
import { listActiveProducts, ownedProductIds } from "../../services/products";
import { CB, type CourseSection } from "../ui/callbacks";
import { paginate, type Screen } from "../ui/render";

const PAGE_SIZE = 8;

function priceLine(product: Product): string {
  if (product.price <= 0) return "—";
  const now = `<b>${formatMoney(product.price)} so'm</b>`;
  return product.oldPrice && product.oldPrice > product.price ? `<s>${formatMoney(product.oldPrice)}</s> ${now}` : now;
}

/** 📚 Darsliklar: sahifalangan ro'yxat, olingan darsliklar ✅ bilan belgilanadi */
export async function catalogScreen(ctx: BotContext, page = 1): Promise<Screen> {
  const [products, owned] = await Promise.all([
    listActiveProducts(),
    ctx.user ? ownedProductIds(ctx.user.id) : Promise.resolve(new Set<number>()),
  ]);
  if (products.length === 0) {
    return { text: await ctx.t("no_products"), keyboard: withNav(new InlineKeyboard(), ctx.lang) };
  }
  const p = paginate(products, page, PAGE_SIZE);
  const kb = withWebAppButton(new InlineKeyboard(), ctx.lang);
  for (const product of p.items) {
    const price = product.price > 0 ? ` — ${formatSum(product.price)}` : "";
    kb.text(`${owned.has(product.id) ? "✅ " : ""}${product.title}${price}`, CB.product(product.code)).row();
  }
  withPagination(kb, p.page, p.pages, CB.catalog);
  return { text: await ctx.t("choose_product"), keyboard: withNav(kb, ctx.lang) };
}

/** Mahsulot kartochkasi: tavsif, narx, "Olaman" va navigatsiya */
/** Kursning to'ldirilgan bo'limlari — faqat shular uchun tugma chiqadi */
function courseSections(product: Product): CourseSection[] {
  const hasAbout = !!(product.duration || product.lessonsCount || product.startDate || product.audience || product.benefits);
  return [...(hasAbout ? (["about"] as const) : []), "price", ...(product.program ? (["program"] as const) : []), ...(product.teacher ? (["teacher"] as const) : [])];
}

const SECTION_LABEL = { about: "btn_course_about", price: "btn_course_price", program: "btn_course_program", teacher: "btn_course_teacher" } as const;

export async function productScreen(ctx: BotContext, product: Product): Promise<Screen> {
  const text = await ctx.t("product_caption", { mahsulot: product.title, tavsif: product.description }, { narx_qator: priceLine(product) });
  const kb = new InlineKeyboard();
  // Kurs bo'limlari (ikki ustunda): 📚 Kurs haqida · 💰 Narxi · 🎓 Dastur · 👨‍🏫 O'qituvchi
  const sections = courseSections(product);
  if (sections.length > 1) {
    sections.forEach((s, i) => {
      kb.text(ctx.label(SECTION_LABEL[s]), CB.productInfo(product.code, s));
      if (i % 2 === 1) kb.row();
    });
    if (sections.length % 2 === 1) kb.row();
  }
  withAskButton(kb.text(ctx.label("btn_buy"), CB.buy(product.code)), ctx.lang);
  // Mini App aynan shu darslik sahifasida ochiladi (bot → ilova o'tishida kontekst saqlanadi)
  const appPath = `product/${encodeURIComponent(product.code)}`;
  if (webAppUrl(appPath)) withWebAppButton(kb.row(), ctx.lang, appPath);
  return { text, keyboard: withNav(kb, ctx.lang, CB.catalog()) };
}

/** Kurs bo'limi ekrani: matn va "Sotib olish" / "Orqaga (kursga)" */
export async function courseSectionScreen(ctx: BotContext, product: Product, section: CourseSection): Promise<Screen> {
  const vars = { mahsulot: product.title };
  let text: string;
  switch (section) {
    case "about": {
      const facts = [
        product.duration && (await ctx.t("course_fact_duration", { v: product.duration })),
        product.lessonsCount && (await ctx.t("course_fact_lessons", { v: product.lessonsCount })),
        product.startDate && (await ctx.t("course_fact_start", { v: formatDate(product.startDate) })),
      ].filter(Boolean);
      const blocks = [
        product.audience && (await ctx.t("course_fact_audience", { v: product.audience })),
        product.benefits && (await ctx.t("course_fact_benefits", { v: product.benefits })),
      ].filter(Boolean);
      text = [await ctx.t("course_about_title", vars), escapeHtml(product.description), facts.join("\n"), ...blocks].filter(Boolean).join("\n\n");
      break;
    }
    case "price":
      text = await ctx.t("course_price", vars, { narx_qator: priceLine(product) });
      break;
    case "program":
      text = await ctx.t("course_program", { ...vars, v: product.program ?? "—" });
      break;
    case "teacher":
      text = await ctx.t("course_teacher", { ...vars, v: product.teacher ?? "—" });
      break;
  }
  const kb = new InlineKeyboard().text(ctx.label("btn_buy"), CB.buy(product.code)).row();
  return { text, keyboard: withNav(kb, ctx.lang, CB.product(product.code)) };
}

export type OrderWithProduct = Order & { product: Product };

/**
 * To'lov ma'lumoti: summa, karta (nusxalash tugmasi bilan), muddat.
 * Chek yuborilmagan buyurtmani shu yerdan bekor qilish mumkin (tasdiqlash oynasi orqali).
 */
export async function paymentScreen(ctx: BotContext, order: OrderWithProduct): Promise<Screen> {
  if (order.status === "receipt_sent") {
    return {
      text: await ctx.t("payment_under_review", { raqam: order.id.toString() }),
      keyboard: withNav(new InlineKeyboard(), ctx.lang, CB.purchases()),
    };
  }
  const card = order.cardId ? await prisma.card.findUnique({ where: { id: order.cardId } }) : null;
  let text = await ctx.t("payment_info", {
    raqam: order.id.toString(),
    mahsulot: order.product.title,
    summa: formatSum(order.amount),
    karta: card ? groupCard(card.number) : "—",
    karta_egasi: card ? `${card.holder}${card.bank ? ` (${card.bank})` : ""}` : "—",
    muddat: formatDateTime(order.expiresAt),
  });
  if (order.status === "rejected" && order.shortfall) {
    text += await ctx.t("payment_info_shortfall", { farq: formatSum(order.shortfall) });
  }
  const kb = new InlineKeyboard();
  // Bir bosishda karta raqami nusxalanadi — bank ilovasiga o'tishda qulay
  if (card) kb.copyText(ctx.label("btn_copy_card"), card.number).row();
  if (order.status === "new") kb.text(ctx.label("btn_cancel_order"), CB.cancelOrder(order.id)).row();
  withAskButton(kb, ctx.lang);
  return { text, keyboard: withNav(kb, ctx.lang, CB.purchases()) };
}

/** ❓ Buyurtmani bekor qilishni tasdiqlash */
export async function cancelOrderConfirmScreen(ctx: BotContext, order: OrderWithProduct): Promise<Screen> {
  return {
    text: await ctx.t("order_cancel_confirm", { raqam: order.id.toString(), mahsulot: order.product.title }),
    keyboard: new InlineKeyboard()
      .text(ctx.label("btn_cancel_yes"), CB.cancelOrderConfirm(order.id))
      .text(ctx.label("btn_cancel_no"), CB.pay(order.id)),
  };
}

export async function orderCancelledScreen(ctx: BotContext, orderId: bigint): Promise<Screen> {
  return {
    text: await ctx.t("order_cancelled", { raqam: orderId.toString() }),
    keyboard: withNav(new InlineKeyboard().text(ctx.label("menu_products"), CB.catalog()), ctx.lang),
  };
}
