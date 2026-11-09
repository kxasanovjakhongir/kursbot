import { InlineKeyboard } from "grammy";
import type { Product } from "@prisma/client";
import type { BotContext } from "../context";
import { withColor, withPagination, withScreenButtons } from "../keyboards";
import { prisma } from "../../db";
import { joinParts } from "../../i18n";
import { buttonColors, buttonSwitch } from "../../services/buttons";
import { listLessons } from "../../services/lessons";
import { componentProducts } from "../../services/products";
import { courseNameFormatter, displayCourseName } from "../../services/settings";
import { CB } from "../ui/callbacks";
import { paginate, type Screen } from "../ui/render";

const PAGE_SIZE = 8;

/** Tugmadagi dars nomi: "▶️ 3. Kirish" (Telegram tugmasi uzun matnni o'zi qisqartiradi) */
const lessonButton = (icon: string, position: number, title: string) => `${icon} ${position}. ${title}`.slice(0, 64);

async function isChannelMember(ctx: BotContext, channelId: string): Promise<boolean> {
  try {
    const m = await ctx.api.getChatMember(Number(channelId), ctx.from!.id);
    return m.status === "member" || m.status === "administrator" || m.status === "creator" || (m.status === "restricted" && m.is_member);
  } catch {
    return false;
  }
}

/**
 * Kanalga to'g'ridan-to'g'ri URL (callback'siz): kanalga allaqachon qo'shilgan bo'lsa — kanalning o'zi,
 * aks holda hali amal qilayotgan shaxsiy havola. Ikkalasi ham yo'q bo'lsa — null (yangi havola callback bilan yaratiladi).
 */
async function directChannelUrl(
  ctx: BotContext,
  product: Pick<Product, "channelId">,
  grant: { inviteLink: string | null; linkExpiresAt: Date | null; joinedAt: Date | null },
): Promise<string | null> {
  const id = product.channelId?.toString();
  // Qo'shilgan bo'lsa ham kanaldan chiqib ketgan bo'lishi mumkin — a'zolik Telegramdan tekshiriladi
  if (grant.joinedAt && id?.startsWith("-100") && (await isChannelMember(ctx, id))) return `https://t.me/c/${id.slice(4)}/1`;
  if (grant.inviteLink && grant.linkExpiresAt && grant.linkExpiresAt > new Date()) return grant.inviteLink;
  return null;
}

/**
 * Xarid qilingan kurs: darslar ro'yxati (bosilsa video keladi) va yopiq kanal havolasi.
 * To'plam bo'lsa — tarkibidagi kurslar (darslar har bir kursning o'zida).
 */
export async function ownedCourseScreen(ctx: BotContext, product: Product, page = 1): Promise<Screen> {
  const kb = new InlineKeyboard();
  if (product.type === "bundle") {
    const name = await courseNameFormatter();
    for (const part of await componentProducts(product)) kb.text(name(part.title), CB.product(part.code)).row();
    return { text: await ctx.t("course_bundle_owned", { mahsulot: name(product.title) }), keyboard: await withScreenButtons(kb, ctx.lang, "owned", CB.catalog()) };
  }

  const [lessons, grant] = await Promise.all([
    listLessons(product.id),
    product.channelId
      ? prisma.accessGrant.findFirst({ where: { userId: ctx.user!.id, productId: product.id, revokedAt: null }, select: { id: true, inviteLink: true, linkExpiresAt: true, joinedAt: true } })
      : Promise.resolve(null),
  ]);
  const p = paginate(lessons, page, PAGE_SIZE);
  const offset = (p.page - 1) * PAGE_SIZE;
  p.items.forEach((l, i) => kb.text(lessonButton("▶️", offset + i + 1, l.title), CB.lesson(l.id)).row());
  withPagination(kb, p.page, p.pages, (n) => CB.lessons(product.code, n));
  if (grant && (await buttonSwitch("owned"))("channel_link")) {
    const direct = await directChannelUrl(ctx, product, grant);
    kb.row();
    // To'g'ridan-to'g'ri havola bo'lsa — tugma kanalning o'ziga olib boradi (ikkinchi xabarsiz)
    if (direct) kb.url(ctx.label("btn_channel_link"), direct);
    else kb.text(ctx.label("btn_channel_link"), CB.link(grant.id));
  }

  const hint = lessons.length ? await ctx.t("course_lessons_hint", { soni: lessons.length }) : await ctx.t("course_no_lessons");
  const text = joinParts([await ctx.t("course_owned", { mahsulot: await displayCourseName(product.title) }), hint]);
  return { text, keyboard: await withScreenButtons(kb, ctx.lang, "owned", CB.catalog()) };
}

/** Xarid qilinmagan kurs darslari: nomlari ko'rinadi (🔒), bosilsa — "avval kursni xarid qiling" */
export async function lockedLessonsScreen(ctx: BotContext, product: Product, page = 1): Promise<Screen> {
  const lessons = await listLessons(product.id);
  const p = paginate(lessons, page, PAGE_SIZE);
  const offset = (p.page - 1) * PAGE_SIZE;
  const kb = new InlineKeyboard();
  p.items.forEach((l, i) => kb.text(lessonButton("🔒", offset + i + 1, l.title), CB.lesson(l.id)).row());
  withPagination(kb, p.page, p.pages, (n) => CB.lessons(product.code, n));
  if ((await buttonSwitch("lessons_locked"))("buy")) withColor(kb.row().text(ctx.label("btn_buy"), CB.buy(product.code)), (await buttonColors("lessons_locked"))("buy"));
  return {
    text: await ctx.t("lessons_title", { mahsulot: await displayCourseName(product.title), soni: lessons.length }),
    keyboard: await withScreenButtons(kb, ctx.lang, "lessons_locked", CB.product(product.code)),
  };
}
