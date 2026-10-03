import { InlineKeyboard } from "grammy";
import type { Product } from "@prisma/client";
import type { BotContext } from "../context";
import { withNav, withPagination } from "../keyboards";
import { prisma } from "../../db";
import { listLessons } from "../../services/lessons";
import { componentProducts } from "../../services/products";
import { courseNameFormatter, displayCourseName } from "../../services/settings";
import { CB } from "../ui/callbacks";
import { paginate, type Screen } from "../ui/render";

const PAGE_SIZE = 8;

/** Tugmadagi dars nomi: "▶️ 3. Kirish" (Telegram tugmasi uzun matnni o'zi qisqartiradi) */
const lessonButton = (icon: string, position: number, title: string) => `${icon} ${position}. ${title}`.slice(0, 64);

/**
 * Xarid qilingan kurs: darslar ro'yxati (bosilsa video keladi) va yopiq kanal havolasi.
 * To'plam bo'lsa — tarkibidagi kurslar (darslar har bir kursning o'zida).
 */
export async function ownedCourseScreen(ctx: BotContext, product: Product, page = 1): Promise<Screen> {
  const kb = new InlineKeyboard();
  if (product.type === "bundle") {
    const name = await courseNameFormatter();
    for (const part of await componentProducts(product)) kb.text(name(part.title), CB.product(part.code)).row();
    return { text: await ctx.t("course_bundle_owned", { mahsulot: name(product.title) }), keyboard: withNav(kb, ctx.lang, CB.catalog()) };
  }

  const [lessons, grant] = await Promise.all([
    listLessons(product.id),
    product.channelId
      ? prisma.accessGrant.findFirst({ where: { userId: ctx.user!.id, productId: product.id, revokedAt: null }, select: { id: true } })
      : Promise.resolve(null),
  ]);
  const p = paginate(lessons, page, PAGE_SIZE);
  const offset = (p.page - 1) * PAGE_SIZE;
  p.items.forEach((l, i) => kb.text(lessonButton("▶️", offset + i + 1, l.title), CB.lesson(l.id)).row());
  withPagination(kb, p.page, p.pages, (n) => CB.lessons(product.code, n));
  if (grant) kb.row().text(ctx.label("btn_channel_link"), CB.link(grant.id));

  const hint = lessons.length ? await ctx.t("course_lessons_hint", { soni: lessons.length }) : await ctx.t("course_no_lessons");
  const text = `${await ctx.t("course_owned", { mahsulot: await displayCourseName(product.title) })}\n\n${hint}`;
  return { text, keyboard: withNav(kb, ctx.lang, CB.catalog()) };
}

/** Xarid qilinmagan kurs darslari: nomlari ko'rinadi (🔒), bosilsa — "avval kursni xarid qiling" */
export async function lockedLessonsScreen(ctx: BotContext, product: Product, page = 1): Promise<Screen> {
  const lessons = await listLessons(product.id);
  const p = paginate(lessons, page, PAGE_SIZE);
  const offset = (p.page - 1) * PAGE_SIZE;
  const kb = new InlineKeyboard();
  p.items.forEach((l, i) => kb.text(lessonButton("🔒", offset + i + 1, l.title), CB.lesson(l.id)).row());
  withPagination(kb, p.page, p.pages, (n) => CB.lessons(product.code, n));
  kb.row().text(ctx.label("btn_buy"), CB.buy(product.code));
  return {
    text: await ctx.t("lessons_title", { mahsulot: await displayCourseName(product.title), soni: lessons.length }),
    keyboard: withNav(kb, ctx.lang, CB.product(product.code)),
  };
}
