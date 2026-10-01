import { Composer, InlineKeyboard } from "grammy";
import type { Message } from "grammy/types";
import { z } from "zod";
import type { BotContext } from "../context";
import { withNav, withPagination } from "../keyboards";
import { CB } from "../ui/callbacks";
import { paginate, render, type Screen } from "../ui/render";
import { prisma } from "../../db";
import { allLabels, type TextKey } from "../../i18n";
import { escapeHtml, formatDateTime, truncate } from "../../lib/format";
import { logger } from "../../lib/logger";
import { audit } from "../../services/events";
import {
  createLesson,
  deleteLesson,
  extractLessonMedia,
  findDuplicateLesson,
  getLessonCourse,
  isUnavailableFileError,
  LESSON_CAPTION_MAX,
  LESSON_TITLE_MAX,
  lessonPosition,
  listLessonCourses,
  listLessons,
  moveLesson,
  sendLesson,
  updateLesson,
  type LessonMedia,
  type MediaRejection,
} from "../../services/lessons";
import { can } from "../../services/permissions";
import { SharedState } from "../../services/sharedState";

/**
 * Bot ichida kurs darslarini (videolarni) boshqarish — "lessons.manage" ruxsati (admin va super admin).
 *
 * Qo'shish: admin videoni yuboradi yoki forward qiladi → kursni tanlaydi → dars nomini yozadi.
 * Video serverga yuklab olinmaydi: faqat Telegram file_id va metadata bazaga yoziladi.
 */
export const adminLessons = new Composer<BotContext>();
const managers = adminLessons.chatType("private").filter((ctx) => can(ctx.role, "lessons.manage"));

const PAGE_SIZE = 10;

const mediaSchema = z.object({
  mediaType: z.enum(["video", "document"]),
  fileId: z.string(),
  fileUniqueId: z.string(),
  chatId: z.coerce.bigint(),
  messageId: z.coerce.bigint(),
  fileName: z.string().nullable(),
  mimeType: z.string().nullable(),
  fileSize: z.coerce.bigint().nullable(),
  duration: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  caption: z.string().nullable(),
});

/** Suhbat holati (barcha instanslar uchun umumiy, 30 daqiqa) */
const flow = new SharedState(
  "lesson_flow",
  30 * 60_000,
  z.discriminatedUnion("step", [
    // "Video qo'shish" bosildi — video kutilmoqda (kurs oldindan tanlangan bo'lishi mumkin)
    z.object({ step: z.literal("await_video"), productId: z.number().int().nullable() }),
    z.object({ step: z.literal("pick_course"), media: mediaSchema }),
    z.object({ step: z.literal("await_title"), media: mediaSchema, productId: z.number().int() }),
    z.object({ step: z.literal("rename"), lessonId: z.number().int() }),
    z.object({ step: z.literal("recaption"), lessonId: z.number().int() }),
  ]),
);

const CBL = {
  add: "al:add",
  addTo: (productId: number) => `al:add:${productId}`,
  cancel: "al:cancel",
  pick: (productId: number) => `al:pick:${productId}`,
  useCaption: "al:usecap",
  course: (productId: number, page = 1) => `al:c:${productId}:${page}`,
  view: (id: number) => `al:v:${id}`,
  play: (id: number) => `al:play:${id}`,
  rename: (id: number) => `al:rn:${id}`,
  recaption: (id: number) => `al:rc:${id}`,
  up: (id: number) => `al:up:${id}`,
  down: (id: number) => `al:dn:${id}`,
  del: (id: number) => `al:del:${id}`,
  delOk: (id: number) => `al:delok:${id}`,
};

const REJECTION_TEXT: Record<MediaRejection, string> = {
  photo: "🖼 Bu rasm. Kursga faqat <b>video</b> qo'shiladi — video yuboring yoki forward qiling.",
  document: "📄 Bu fayl video emas. Video yuboring (oddiy yoki «fayl sifatida» yuborilgan video ham bo'ladi).",
  video_note: "⭕️ Dumaloq video (video xabar) dars sifatida qo'shilmaydi. Oddiy video yuboring.",
  animation: "🎞 GIF animatsiya dars sifatida qo'shilmaydi. Oddiy video yuboring.",
  forward_without_video: "↪️ Forward qilingan xabarda video yo'q. Videoning o'zini forward qiling.",
  no_video: "🎥 Video kutilmoqda. Video yuboring yoki Telegramdan video forward qiling.",
};

const cancelKb = () => new InlineKeyboard().text("❌ Bekor qilish", CBL.cancel);

function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function formatSize(bytes: bigint | null): string | null {
  if (bytes === null) return null;
  const mb = Number(bytes) / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function mediaSummary(m: Pick<LessonMedia, "duration" | "fileSize" | "width" | "height" | "fileName">): string {
  return [
    formatDuration(m.duration) && `⏱ ${formatDuration(m.duration)}`,
    formatSize(m.fileSize) && `💾 ${formatSize(m.fileSize)}`,
    m.width && m.height ? `🖥 ${m.width}×${m.height}` : null,
    m.fileName ? `📄 ${escapeHtml(m.fileName)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ---------- Ekranlar ----------

export async function lessonCoursesScreen(ctx: BotContext): Promise<Screen> {
  const courses = await listLessonCourses();
  const kb = new InlineKeyboard();
  for (const c of courses) kb.text(`${c.isActive ? "📚" : "⏸"} ${c.title} (${c.lessons})`, CBL.course(c.id)).row();
  kb.text("➕ Video qo'shish", CBL.add).row();
  const text =
    "🎥 <b>Darslar (videolar)</b>\n\n" +
    (courses.length ? "Kursni tanlang yoki yangi video qo'shing." : "Hali kurslar yo'q — avval admin panelda kurs (mahsulot) yarating.") +
    "\n\n💡 Eng tez yo'l: videoni shu chatga yuboring yoki Telegramdagi videoni forward qiling — bot kursni so'raydi.";
  return { text, keyboard: withNav(kb, ctx.lang, CB.admin) };
}

async function courseLessonsScreen(ctx: BotContext, productId: number, page: number): Promise<Screen | null> {
  const course = await getLessonCourse(productId);
  if (!course) return null;
  const lessons = await listLessons(course.id);
  const p = paginate(lessons, page, PAGE_SIZE);
  const offset = (p.page - 1) * PAGE_SIZE;
  const kb = new InlineKeyboard();
  p.items.forEach((l, i) => kb.text(`${offset + i + 1}. ${l.title}`.slice(0, 64), CBL.view(l.id)).row());
  withPagination(kb, p.page, p.pages, (n) => CBL.course(course.id, n));
  kb.row().text("➕ Video qo'shish", CBL.addTo(course.id));
  const text = `📚 <b>${escapeHtml(course.title)}</b>\n\n` + (lessons.length ? `🎬 Darslar: ${lessons.length} ta. Tahrirlash uchun darsni tanlang.` : "Bu kursda hali darslar yo'q.");
  return { text, keyboard: withNav(kb, ctx.lang, CB.adminLessons) };
}

async function lessonCardScreen(ctx: BotContext, id: number): Promise<Screen | null> {
  const lesson = await prisma.lesson.findUnique({ where: { id }, include: { product: { select: { title: true } } } });
  if (!lesson) return null;
  const position = await lessonPosition(lesson);
  const meta = mediaSummary(lesson);
  const lines = [
    `🎬 <b>${position}. ${escapeHtml(lesson.title)}</b>`,
    `📚 Kurs: ${escapeHtml(lesson.product.title)}`,
    meta || null,
    `🗓 Qo'shilgan: ${formatDateTime(lesson.createdAt)}`,
    lesson.caption ? `\n📝 Izoh:\n${escapeHtml(truncate(lesson.caption, 600))}` : "\n📝 Izoh: —",
  ].filter((l): l is string => l !== null);
  const kb = new InlineKeyboard()
    .text("▶️ Ko'rish", CBL.play(id))
    .row()
    .text("✏️ Nomi", CBL.rename(id))
    .text("📝 Izoh", CBL.recaption(id))
    .row()
    .text("⬆️ Yuqoriga", CBL.up(id))
    .text("⬇️ Pastga", CBL.down(id))
    .row()
    .text("🗑 O'chirish", CBL.del(id));
  return { text: lines.join("\n"), keyboard: withNav(kb, ctx.lang, CBL.course(lesson.productId)) };
}

async function showCard(ctx: BotContext, id: number): Promise<void> {
  const screen = await lessonCardScreen(ctx, id);
  if (!screen) {
    await ctx.answerCallbackQuery({ text: "Dars topilmadi (o'chirilgan bo'lishi mumkin)", show_alert: true }).catch(() => undefined);
    return render(ctx, await lessonCoursesScreen(ctx));
  }
  await render(ctx, screen);
}

/** Kurs tanlash tugmalari (video qabul qilingandan keyin) */
async function coursePicker(): Promise<InlineKeyboard | null> {
  const courses = await listLessonCourses();
  if (!courses.length) return null;
  const kb = new InlineKeyboard();
  for (const c of courses) kb.text(`${c.isActive ? "📚" : "⏸"} ${c.title}`, CBL.pick(c.id)).row();
  return kb.text("❌ Bekor qilish", CBL.cancel);
}

// ---------- Video qo'shish oqimi ----------

async function askTitle(ctx: BotContext, media: LessonMedia, productId: number): Promise<void> {
  const course = await getLessonCourse(productId);
  if (!course) {
    await flow.delete(ctx.from!.id);
    await ctx.reply("❌ Kurs topilmadi (o'chirilgan bo'lishi mumkin).");
    return;
  }
  const dup = await findDuplicateLesson(course.id, media.fileUniqueId);
  if (dup) {
    await flow.delete(ctx.from!.id);
    await ctx.reply(`⚠️ Bu video «${escapeHtml(course.title)}» kursiga allaqachon qo'shilgan: <b>${await lessonPosition(dup)}. ${escapeHtml(dup.title)}</b>`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("🎬 Darsni ochish", CBL.view(dup.id)),
    });
    return;
  }
  await flow.set(ctx.from!.id, { step: "await_title", media, productId: course.id });
  const kb = new InlineKeyboard();
  if (media.caption) kb.text("📝 Video izohini nom qilish", CBL.useCaption).row();
  kb.text("❌ Bekor qilish", CBL.cancel);
  await render(ctx, { text: `📚 Kurs: <b>${escapeHtml(course.title)}</b>\n\n✏️ Dars nomini kiriting:\n<i>Masalan: 1-dars: JavaScript Introduction</i>`, keyboard: kb });
}

async function acceptVideo(ctx: BotContext, media: LessonMedia, presetCourse: number | null): Promise<void> {
  if (presetCourse) return askTitle(ctx, media, presetCourse);
  const kb = await coursePicker();
  if (!kb) {
    await ctx.reply("❌ Hali kurslar yo'q. Avval admin panelda kurs (mahsulot) yarating.");
    return;
  }
  await flow.set(ctx.from!.id, { step: "pick_course", media });
  const meta = mediaSummary(media);
  await ctx.reply(`✅ Video qabul qilindi.${meta ? `\n${meta}` : ""}\n\nKursni tanlang:`, {
    parse_mode: "HTML",
    reply_markup: kb,
    reply_parameters: { message_id: Number(media.messageId), allow_sending_without_reply: true },
  });
}

async function saveLesson(ctx: BotContext, media: LessonMedia, productId: number, title: string): Promise<void> {
  const res = await createLesson({ productId, title, media, adminId: ctx.admin?.id ?? null });
  if (res.kind === "no_course") {
    await ctx.reply("❌ Kurs topilmadi (o'chirilgan bo'lishi mumkin). Videoni qaytadan yuboring.");
    return;
  }
  if (res.kind === "duplicate") {
    await ctx.reply(`⚠️ Bu video bu kursga allaqachon qo'shilgan: <b>${escapeHtml(res.lesson.title)}</b>`, { parse_mode: "HTML" });
    return;
  }
  const course = await getLessonCourse(productId);
  await audit(ctx.admin?.id ?? null, "add_lesson", "lesson", res.lesson.id, null, { productId, title: res.lesson.title, fileUniqueId: media.fileUniqueId });
  await ctx.reply(
    `✅ Video kursga muvaffaqiyatli qo'shildi.\n\n📚 Kurs: <b>${escapeHtml(course?.title ?? "—")}</b>\n🎬 Dars: <b>${res.position}. ${escapeHtml(res.lesson.title)}</b>`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("➕ Yana video qo'shish", CBL.addTo(productId)).row().text("📋 Kurs darslari", CBL.course(productId)),
    },
  );
}

const MENU_KEYS: TextKey[] = ["menu_products", "menu_help", "menu_admin", "menu_profile", "menu_settings", "btn_cancel"];
const menuLabels = new Set(MENU_KEYS.flatMap((k) => allLabels(k)));

/** Holat kutayotgan matn: menyu tugmasi yoki buyruq bosilsa — oqim to'xtatiladi va xabar odatdagidek ishlanadi */
function isEscape(text: string): boolean {
  return text.startsWith("/") || menuLabels.has(text);
}

async function handleText(ctx: BotContext, text: string, state: NonNullable<Awaited<ReturnType<typeof flow.get>>>): Promise<boolean> {
  const id = ctx.from!.id;
  if (state.step === "await_title") {
    const title = text.trim();
    if (!title || title.length > LESSON_TITLE_MAX) {
      await ctx.reply(`✏️ Dars nomi 1–${LESSON_TITLE_MAX} belgi bo'lishi kerak. Qaytadan kiriting:`, { reply_markup: cancelKb() });
      return true;
    }
    // Atomik: ikki marta yuborilgan nom ikkita dars yaratmaydi
    const taken = await flow.take(id);
    if (taken?.step !== "await_title") return true;
    await saveLesson(ctx, taken.media, taken.productId, title);
    return true;
  }
  if (state.step === "rename" || state.step === "recaption") {
    const value = text.trim();
    const max = state.step === "rename" ? LESSON_TITLE_MAX : LESSON_CAPTION_MAX;
    if (!value || value.length > max) {
      await ctx.reply(`Matn 1–${max} belgi bo'lishi kerak. Qaytadan kiriting:`, { reply_markup: cancelKb() });
      return true;
    }
    await flow.delete(id);
    const data = state.step === "rename" ? { title: value } : { caption: value === "-" ? null : value };
    const updated = await updateLesson(state.lessonId, data);
    if (!updated) {
      await ctx.reply("❌ Dars topilmadi (o'chirilgan bo'lishi mumkin).");
      return true;
    }
    await audit(ctx.admin?.id ?? null, state.step === "rename" ? "rename_lesson" : "update_lesson_caption", "lesson", updated.id, null, data);
    await ctx.reply("✅ Saqlandi.");
    const screen = await lessonCardScreen(ctx, updated.id);
    if (screen) await render(ctx, screen);
    return true;
  }
  if (state.step === "await_video") {
    await ctx.reply(REJECTION_TEXT.no_video, { parse_mode: "HTML", reply_markup: cancelKb() });
    return true;
  }
  // pick_course: matn kutilmaydi — tugmani eslatamiz
  await ctx.reply("☝️ Yuqoridagi tugmalardan kursni tanlang.", { reply_markup: cancelKb() });
  return true;
}

/**
 * Adminning har qanday xabari: video (yoki video-fayl) — qo'shish oqimi boshlanadi; holat kutilayotgan
 * bo'lsa — matn (nom/izoh) yoki noto'g'ri media uchun aniq javob. Boshqa hollarda (masalan, admin mijoz
 * sifatida chek yuborsa) xabar keyingi handlerlarga o'tadi.
 */
managers.on("message", async (ctx, next) => {
  const msg: Message = ctx.message;
  const id = ctx.from.id;
  const res = extractLessonMedia(msg);

  if (res.ok) {
    const state = await flow.get(id);
    return acceptVideo(ctx, res.media, state?.step === "await_video" ? state.productId : null);
  }

  const state = await flow.get(id);
  if (!state) return next();

  if (msg.text !== undefined && !msg.forward_origin) {
    if (isEscape(msg.text)) {
      // Buyruq yoki menyu — oqim bekor qilinadi (bekor qilish buyrug'i alohida javob oladi)
      await flow.delete(id);
      if (msg.text === "/cancel") return void (await ctx.reply("❌ Bekor qilindi."));
      return next();
    }
    await handleText(ctx, msg.text, state);
    return;
  }
  if (state.step === "await_video" || state.step === "pick_course") {
    await ctx.reply(REJECTION_TEXT[res.reason], { parse_mode: "HTML", reply_markup: cancelKb() });
    return;
  }
  await ctx.reply("✏️ Matn kutilmoqda.", { reply_markup: cancelKb() });
});

// ---------- Tugmalar ----------

managers.callbackQuery(CB.adminLessons, async (ctx) => render(ctx, await lessonCoursesScreen(ctx)));

managers.callbackQuery([CBL.add, /^al:add:(\d{1,9})$/], async (ctx) => {
  const productId = typeof ctx.match === "string" ? null : Number(ctx.match[1]);
  const course = productId ? await getLessonCourse(productId) : null;
  if (productId && !course) {
    await ctx.answerCallbackQuery({ text: "Kurs topilmadi", show_alert: true });
    return;
  }
  await flow.set(ctx.from.id, { step: "await_video", productId: course?.id ?? null });
  const target = course ? `\n📚 Kurs: <b>${escapeHtml(course.title)}</b>` : "";
  await ctx.reply(
    `🎥 Video yuboring yoki Telegramdan video forward qiling.${target}\n\n` +
      "<i>Video serverga yuklab olinmaydi — Telegram'ning o'zida saqlanadi. Botda hajm cheklovi yo'q: " +
      "Telegram qabul qilgan video (2 GB gacha, Premium hisobdan 4 GB gacha) qo'shiladi.</i>",
    { parse_mode: "HTML", reply_markup: cancelKb() },
  );
});

managers.callbackQuery(CBL.cancel, async (ctx) => {
  await flow.delete(ctx.from.id);
  await render(ctx, { text: "❌ Bekor qilindi.", keyboard: new InlineKeyboard().text("🎥 Darslar", CB.adminLessons) });
});

managers.callbackQuery(/^al:pick:(\d{1,9})$/, async (ctx) => {
  const state = await flow.get(ctx.from.id);
  if (state?.step !== "pick_course") {
    await ctx.answerCallbackQuery({ text: "Avval video yuboring yoki forward qiling", show_alert: true });
    return;
  }
  await askTitle(ctx, state.media, Number(ctx.match[1]));
});

managers.callbackQuery(CBL.useCaption, async (ctx) => {
  const state = await flow.take(ctx.from.id);
  if (state?.step !== "await_title" || !state.media.caption) {
    await ctx.answerCallbackQuery({ text: "Bu amal eskirgan — videoni qaytadan yuboring", show_alert: true });
    return;
  }
  const title = state.media.caption.split("\n")[0].trim().slice(0, LESSON_TITLE_MAX);
  await saveLesson(ctx, state.media, state.productId, title);
});

managers.callbackQuery(/^al:c:(\d{1,9}):(\d{1,4})$/, async (ctx) => {
  const screen = await courseLessonsScreen(ctx, Number(ctx.match[1]), Number(ctx.match[2]));
  if (!screen) {
    await ctx.answerCallbackQuery({ text: "Kurs topilmadi", show_alert: true });
    return render(ctx, await lessonCoursesScreen(ctx));
  }
  await render(ctx, screen);
});

managers.callbackQuery(/^al:v:(\d{1,9})$/, async (ctx) => showCard(ctx, Number(ctx.match[1])));

managers.callbackQuery(/^al:play:(\d{1,9})$/, async (ctx) => {
  const lesson = await prisma.lesson.findUnique({ where: { id: Number(ctx.match[1]) } });
  if (!lesson) {
    await ctx.answerCallbackQuery({ text: "Dars topilmadi", show_alert: true });
    return;
  }
  try {
    await sendLesson(ctx.api, ctx.from.id, lesson, await lessonPosition(lesson));
  } catch (err) {
    if (!isUnavailableFileError(err)) throw err;
    await ctx.reply("⚠️ Bu video Telegram'da topilmadi (o'chirilgan yoki bot tokeni almashgan). Videoni qaytadan qo'shing va eskisini o'chiring.");
  }
});

managers.callbackQuery(/^al:(rn|rc):(\d{1,9})$/, async (ctx) => {
  const lessonId = Number(ctx.match[2]);
  if (!(await prisma.lesson.findUnique({ where: { id: lessonId }, select: { id: true } }))) {
    await ctx.answerCallbackQuery({ text: "Dars topilmadi", show_alert: true });
    return;
  }
  const rename = ctx.match[1] === "rn";
  await flow.set(ctx.from.id, { step: rename ? "rename" : "recaption", lessonId });
  await ctx.reply(rename ? "✏️ Yangi nomni kiriting:" : "📝 Yangi izohni kiriting (izohni o'chirish uchun «-» yuboring):", { reply_markup: cancelKb() });
});

managers.callbackQuery(/^al:(up|dn):(\d{1,9})$/, async (ctx) => {
  const id = Number(ctx.match[2]);
  const moved = await moveLesson(id, ctx.match[1] === "up" ? "up" : "down");
  if (!moved) await ctx.answerCallbackQuery({ text: ctx.match[1] === "up" ? "Bu birinchi dars" : "Bu oxirgi dars" });
  else await audit(ctx.admin?.id ?? null, "reorder_lesson", "lesson", id, null, { direction: ctx.match[1] });
  await showCard(ctx, id);
});

managers.callbackQuery(/^al:del:(\d{1,9})$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  const lesson = await prisma.lesson.findUnique({ where: { id } });
  if (!lesson) return showCard(ctx, id);
  await render(ctx, {
    text: `🗑 <b>${escapeHtml(lesson.title)}</b> darsini o'chirasizmi?\n\nXaridorlar bu videoni endi ko'ra olmaydi. Telegram'dagi asl xabar o'chmaydi.`,
    keyboard: new InlineKeyboard().text("✅ Ha, o'chirish", CBL.delOk(id)).text("↩️ Yo'q", CBL.view(id)),
  });
});

managers.callbackQuery(/^al:delok:(\d{1,9})$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  const lesson = await prisma.lesson.findUnique({ where: { id } });
  if (!lesson || !(await deleteLesson(id))) {
    await ctx.answerCallbackQuery({ text: "Dars allaqachon o'chirilgan" });
    return render(ctx, await lessonCoursesScreen(ctx));
  }
  await audit(ctx.admin?.id ?? null, "delete_lesson", "lesson", id, { productId: lesson.productId, title: lesson.title }, null);
  logger.info({ lessonId: id, productId: lesson.productId }, "dars o'chirildi");
  await ctx.answerCallbackQuery({ text: "🗑 O'chirildi" });
  const screen = await courseLessonsScreen(ctx, lesson.productId, 1);
  await render(ctx, screen ?? (await lessonCoursesScreen(ctx)));
});

// Ruxsati yo'q foydalanuvchi dars boshqaruvi tugmasini (eski xabar yoki qo'lda yasalgan callback) bossa
adminLessons.callbackQuery([CB.adminLessons, /^al:/], async (ctx) => {
  await ctx.answerCallbackQuery({ text: await ctx.t("adm_no_permission"), show_alert: true });
});
