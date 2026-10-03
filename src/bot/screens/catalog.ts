import { InlineKeyboard } from "grammy";
import type { Order, Product } from "@prisma/client";
import type { BotContext } from "../context";
import { withPagination, withScreenButtons } from "../keyboards";
import { escapeHtml, formatDate, formatDateTime, formatMoney, formatSum, groupCard } from "../../lib/format";
import { prisma } from "../../db";
import { joinParts } from "../../i18n";
import { buttonSwitch } from "../../services/buttons";
import { listActiveProducts, ownedInactiveProducts, ownedProductIds } from "../../services/products";
import { lessonCounts } from "../../services/lessons";
import { courseNameFormatter, displayCourseName } from "../../services/settings";
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
  const [active, owned] = await Promise.all([
    listActiveProducts(),
    ctx.user ? ownedProductIds(ctx.user.id) : Promise.resolve(new Set<number>()),
  ]);
  // Sotuvdan olingan, lekin sotib olingan kurslar ham ko'rinadi — darslar va kanal havolasi shu yerdan
  const products = [...active, ...(await ownedInactiveProducts(owned))];
  if (products.length === 0) {
    return { text: await ctx.t("no_products"), keyboard: await withScreenButtons(new InlineKeyboard(), ctx.lang, "catalog") };
  }
  const p = paginate(products, page, PAGE_SIZE);
  const kb = new InlineKeyboard();
  const name = await courseNameFormatter();
  for (const product of p.items) {
    const price = product.price > 0 ? ` — ${formatSum(product.price)}` : "";
    kb.text(`${owned.has(product.id) ? "✅ " : ""}${name(product.title)}${price}`, CB.product(product.code)).row();
  }
  withPagination(kb, p.page, p.pages, CB.catalog);
  return { text: await ctx.t("choose_product"), keyboard: await withScreenButtons(kb, ctx.lang, "catalog") };
}

/** Mahsulot kartochkasi: tavsif, narx, "Olaman" va navigatsiya */
/** Kursning to'ldirilgan bo'limlari — faqat shular uchun tugma chiqadi */
function courseSections(product: Product): CourseSection[] {
  const hasAbout = !!(product.duration || product.lessonsCount || product.startDate || product.audience || product.benefits);
  return [...(hasAbout ? (["about"] as const) : []), "price", ...(product.program ? (["program"] as const) : []), ...(product.teacher ? (["teacher"] as const) : [])];
}

const SECTION_LABEL = { about: "btn_course_about", price: "btn_course_price", program: "btn_course_program", teacher: "btn_course_teacher" } as const;

export async function productScreen(ctx: BotContext, product: Product): Promise<Screen> {
  // Tavsifi yo'q kursda nom va narx orasida ortiqcha bo'sh qator qolmaydi
  const text = (await ctx.t("product_caption", { mahsulot: await displayCourseName(product.title), tavsif: product.description }, { narx_qator: priceLine(product) })).replace(
    /\n{3,}/g,
    "\n\n",
  );
  const kb = new InlineKeyboard();
  // Kurs bo'limlari (ikki ustunda): 📚 Kurs haqida · 💰 Narxi · 🎓 Dastur · 👨‍🏫 O'qituvchi
  const on = await buttonSwitch("product");
  const sections = courseSections(product);
  if (on("sections") && sections.length > 1) {
    sections.forEach((s, i) => {
      kb.text(ctx.label(SECTION_LABEL[s]), CB.productInfo(product.code, s));
      if (i % 2 === 1) kb.row();
    });
    if (sections.length % 2 === 1) kb.row();
  }
  // Kurs darslari (videolar) — xarid qilmaganlarga nomlari 🔒 bilan ko'rinadi
  const lessons = (await lessonCounts([product.id])).get(product.id) ?? 0;
  if (on("lessons") && lessons > 0) kb.text(ctx.label("btn_lessons", { soni: lessons }), CB.lessons(product.code)).row();
  if (on("buy")) kb.text(ctx.label("btn_buy"), CB.buy(product.code));
  // Kurs kartochkasida "⬅️ Orqaga" yo'q — faqat "🏠 Bosh menyu" (katalogga pastki «📚 Darsliklar» orqali)
  return { text, keyboard: await withScreenButtons(kb, ctx.lang, "product") };
}

/** Kurs bo'limi ekrani: matn va "Sotib olish" / "Orqaga (kursga)" */
export async function courseSectionScreen(ctx: BotContext, product: Product, section: CourseSection): Promise<Screen> {
  const vars = { mahsulot: await displayCourseName(product.title) };
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
      text = joinParts([await ctx.t("course_about_title", vars), escapeHtml(product.description), facts.join("\n"), ...blocks]);
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
  const kb = new InlineKeyboard();
  if ((await buttonSwitch("course_section"))("buy")) kb.text(ctx.label("btn_buy"), CB.buy(product.code));
  return { text, keyboard: await withScreenButtons(kb, ctx.lang, "course_section", CB.product(product.code)) };
}

export type OrderWithProduct = Order & { product: Product };

/**
 * To'lov ma'lumoti: summa, karta (nusxalash tugmasi bilan), muddat.
 * "Buyurtmani bekor qilish" tugmasi yo'q; oldin yuborilgan xabarlardagi tugma (ord:cancel) ishlashda davom etadi.
 */
export async function paymentScreen(ctx: BotContext, order: OrderWithProduct): Promise<Screen> {
  if (order.status === "receipt_sent") {
    return {
      text: await ctx.t("payment_under_review", { raqam: order.id.toString() }),
      keyboard: await withScreenButtons(new InlineKeyboard(), ctx.lang, "payment", CB.product(order.product.code)),
    };
  }
  const card = order.cardId ? await prisma.card.findUnique({ where: { id: order.cardId } }) : null;
  const vars = {
    raqam: order.id.toString(),
    mahsulot: await displayCourseName(order.product.title),
    summa: formatSum(order.amount),
    karta: card ? groupCard(card.number) : "—",
    karta_egasi: card ? `${card.holder}${card.bank ? ` (${card.bank})` : ""}` : "—",
  };
  // Sarlavha (karta ma'lumoti) + paneldan tahrirlanadigan ko'rsatmalar; muddat — buyurtmaning o'zidan
  // Paneldan o'chirilgan yoki bo'sh qoldirilgan qismlar tushib qoladi
  let text = joinParts([
    await ctx.t("payment_info", vars),
    joinParts([await ctx.t("payment_step_1", vars), await ctx.t("payment_step_2", vars)], "\n"),
    await ctx.t("payment_expires", { expires_at: formatDateTime(order.expiresAt) }),
  ]);
  if (order.status === "rejected" && order.shortfall) {
    text += await ctx.t("payment_info_shortfall", { farq: formatSum(order.shortfall) });
  }
  const kb = new InlineKeyboard();
  // Bir bosishda karta raqami nusxalanadi — bank ilovasiga o'tishda qulay
  if (card && (await buttonSwitch("payment"))("copy_card")) kb.copyText(ctx.label("btn_copy_card"), card.number);
  return { text, keyboard: await withScreenButtons(kb, ctx.lang, "payment", CB.product(order.product.code)) };
}

/** ❓ Buyurtmani bekor qilishni tasdiqlash */
export async function cancelOrderConfirmScreen(ctx: BotContext, order: OrderWithProduct): Promise<Screen> {
  return {
    text: await ctx.t("order_cancel_confirm", { raqam: order.id.toString(), mahsulot: await displayCourseName(order.product.title) }),
    keyboard: new InlineKeyboard()
      .text(ctx.label("btn_cancel_yes"), CB.cancelOrderConfirm(order.id))
      .text(ctx.label("btn_cancel_no"), CB.pay(order.id)),
  };
}

export async function orderCancelledScreen(ctx: BotContext, orderId: bigint): Promise<Screen> {
  return {
    text: await ctx.t("order_cancelled", { raqam: orderId.toString() }),
    keyboard: await withScreenButtons(new InlineKeyboard(), ctx.lang, "order_cancelled"),
  };
}
