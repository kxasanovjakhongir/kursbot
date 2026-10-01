import { GrammyError, type Api } from "grammy";
import type { Message } from "grammy/types";
import { Prisma, type Lesson, type LessonMediaType, type Product } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { logger } from "../lib/logger";
import { escapeHtml, stripHtml, truncate } from "../lib/format";

/**
 * Kurs darslari (videolar). Video serverga yuklab olinmaydi va qayta yuklanmaydi: admin botga yuborgan
 * (yoki forward qilgan) xabardagi Telegram file_id saqlanadi, mijozga ham shu file_id orqali yuboriladi.
 *
 * Hajm bo'yicha kodda sun'iy limit yo'q. Telegram cheklovlari:
 *  - botga keladigan video/fayl: oddiy hisobdan 2 GB gacha, Telegram Premium hisobdan 4 GB gacha
 *    (bu limitdan katta faylni Telegram'ning o'zi yubortirmaydi — bot uni umuman ko'rmaydi);
 *  - file_id orqali qayta yuborish (sendVideo/sendDocument) — hajmga bog'liq emas, chunki fayl Telegram'da turibdi;
 *  - Bot API getFile (serverga yuklab olish) — 20 MB, multipart upload — 50 MB: bu oqimda ikkalasi ham ishlatilmaydi.
 */

/** Telegram'dan kelgan video ma'lumotlari (bazaga yoziladigan ko'rinishda) */
export interface LessonMedia {
  mediaType: LessonMediaType;
  fileId: string;
  fileUniqueId: string;
  chatId: bigint;
  messageId: bigint;
  fileName: string | null;
  mimeType: string | null;
  fileSize: bigint | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  caption: string | null;
}

export type MediaRejection =
  /** Rasm keldi */
  | "photo"
  /** Video bo'lmagan fayl (PDF, arxiv, rasm fayli ...) */
  | "document"
  /** Dumaloq video yoki GIF — kurs darsi sifatida yuborib bo'lmaydi */
  | "video_note"
  | "animation"
  /** Forward qilingan xabarda video yo'q (matn, ovoz va h.k.) */
  | "forward_without_video"
  /** Umuman media yo'q */
  | "no_video";

export type MediaResult = { ok: true; media: LessonMedia } | { ok: false; reason: MediaRejection };

/**
 * Xabardan kurs videosini ajratadi. Video ikki ko'rinishda keladi: oddiy video (telefon/galereyadan
 * yoki forward) va "fayl sifatida" yuborilgan video (kompyuterdan, katta fayllar odatda shunday) — mime video/*.
 */
export function extractLessonMedia(msg: Message): MediaResult {
  const base = {
    chatId: BigInt(msg.chat.id),
    messageId: BigInt(msg.message_id),
    caption: msg.caption?.trim() || null,
  };
  if (msg.video) {
    const v = msg.video;
    return {
      ok: true,
      media: {
        ...base,
        mediaType: "video",
        fileId: v.file_id,
        fileUniqueId: v.file_unique_id,
        fileName: v.file_name ?? null,
        mimeType: v.mime_type ?? null,
        fileSize: v.file_size !== undefined ? BigInt(v.file_size) : null,
        duration: v.duration ?? null,
        width: v.width ?? null,
        height: v.height ?? null,
      },
    };
  }
  // Animatsiya xabarida document maydoni ham bo'ladi — undan oldin tekshiriladi
  if (msg.animation) return { ok: false, reason: "animation" };
  if (msg.document) {
    const d = msg.document;
    if (!d.mime_type?.startsWith("video/")) return { ok: false, reason: "document" };
    return {
      ok: true,
      media: {
        ...base,
        mediaType: "document",
        fileId: d.file_id,
        fileUniqueId: d.file_unique_id,
        fileName: d.file_name ?? null,
        mimeType: d.mime_type,
        fileSize: d.file_size !== undefined ? BigInt(d.file_size) : null,
        duration: null,
        width: null,
        height: null,
      },
    };
  }
  if (msg.video_note) return { ok: false, reason: "video_note" };
  if (msg.photo) return { ok: false, reason: "photo" };
  return { ok: false, reason: msg.forward_origin ? "forward_without_video" : "no_video" };
}

export const LESSON_TITLE_MAX = 200;
export const LESSON_CAPTION_MAX = 900;

/** Darslarni faqat oddiy (kanalli) kurslarga qo'shish mumkin: to'plam egalari tarkibidagi kurslar orqali ko'radi */
export async function listLessonCourses(): Promise<(Pick<Product, "id" | "code" | "title" | "isActive"> & { lessons: number; hasIntro: boolean })[]> {
  const products = await prisma.product.findMany({
    where: { deletedAt: null, type: "channel" },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, code: true, title: true, isActive: true, videoFileId: true, _count: { select: { lessons: true } } },
  });
  return products.map(({ _count, videoFileId, ...p }) => ({ ...p, lessons: _count.lessons, hasIntro: !!videoFileId }));
}

/**
 * Kursning tanishtiruv (preview) videosi — sotib olmaganlar ham ko'radi (products.video_file_id, panel bilan umumiy).
 * Faqat oddiy video: u mijozga sendVideo bilan yuboriladi, «fayl sifatida» yuborilgan video file_id si unga mos emas.
 */
export async function setIntroVideo(productId: number, media: Pick<LessonMedia, "mediaType" | "fileId">): Promise<"saved" | "not_video" | "no_course"> {
  if (media.mediaType !== "video") return "not_video";
  const course = await getLessonCourse(productId);
  if (!course) return "no_course";
  await prisma.product.update({ where: { id: course.id }, data: { videoFileId: media.fileId } });
  return "saved";
}

export async function getLessonCourse(productId: number): Promise<Product | null> {
  return prisma.product.findFirst({ where: { id: productId, deletedAt: null, type: "channel" } });
}

export async function listLessons(productId: number): Promise<Lesson[]> {
  return prisma.lesson.findMany({ where: { productId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
}

/** Bir nechta kursning darslari soni — bitta guruhlangan so'rov */
export async function lessonCounts(productIds: number[]): Promise<Map<number, number>> {
  if (!productIds.length) return new Map();
  const rows = await prisma.lesson.groupBy({ by: ["productId"], where: { productId: { in: productIds } }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.productId, r._count._all]));
}

export async function findDuplicateLesson(productId: number, fileUniqueId: string): Promise<Lesson | null> {
  return prisma.lesson.findUnique({ where: { productId_telegramFileUniqueId: { productId, telegramFileUniqueId: fileUniqueId } } });
}

export type CreateLessonResult = { kind: "created"; lesson: Lesson; position: number } | { kind: "duplicate"; lesson: Lesson } | { kind: "no_course" };

export async function createLesson(input: { productId: number; title: string; media: LessonMedia; adminId: number | null }): Promise<CreateLessonResult> {
  const course = await getLessonCourse(input.productId);
  if (!course) return { kind: "no_course" };
  const existing = await findDuplicateLesson(course.id, input.media.fileUniqueId);
  if (existing) return { kind: "duplicate", lesson: existing };
  const { media } = input;
  const last = await prisma.lesson.aggregate({ where: { productId: course.id }, _max: { sortOrder: true }, _count: { _all: true } });
  try {
    const lesson = await prisma.lesson.create({
      data: {
        productId: course.id,
        title: input.title.slice(0, LESSON_TITLE_MAX),
        caption: media.caption ? media.caption.slice(0, LESSON_CAPTION_MAX) : null,
        mediaType: media.mediaType,
        telegramFileId: media.fileId,
        telegramFileUniqueId: media.fileUniqueId,
        telegramChatId: media.chatId,
        telegramMessageId: media.messageId,
        fileName: media.fileName,
        mimeType: media.mimeType,
        fileSize: media.fileSize,
        duration: media.duration,
        width: media.width,
        height: media.height,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        createdById: input.adminId,
      },
    });
    return { kind: "created", lesson, position: last._count._all + 1 };
  } catch (err) {
    // Parallel ikki marta bosish: unique indeks ikkinchisini to'xtatadi
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const dup = await findDuplicateLesson(course.id, media.fileUniqueId);
      if (dup) return { kind: "duplicate", lesson: dup };
    }
    throw err;
  }
}

export async function updateLesson(id: number, data: { title?: string; caption?: string | null; description?: string | null }): Promise<Lesson | null> {
  const found = await prisma.lesson.findUnique({ where: { id }, select: { id: true } });
  if (!found) return null;
  return prisma.lesson.update({ where: { id }, data });
}

export async function deleteLesson(id: number): Promise<boolean> {
  const { count } = await prisma.lesson.deleteMany({ where: { id } });
  return count > 0;
}

/** Darsni bir pog'ona yuqoriga/pastga: qo'shni dars bilan tartib raqami almashtiriladi */
export async function moveLesson(id: number, direction: "up" | "down"): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const lesson = await tx.lesson.findUnique({ where: { id } });
    if (!lesson) return false;
    const neighbor = await tx.lesson.findFirst({
      where:
        direction === "up"
          ? { productId: lesson.productId, OR: [{ sortOrder: { lt: lesson.sortOrder } }, { sortOrder: lesson.sortOrder, id: { lt: lesson.id } }] }
          : { productId: lesson.productId, OR: [{ sortOrder: { gt: lesson.sortOrder } }, { sortOrder: lesson.sortOrder, id: { gt: lesson.id } }] },
      orderBy: direction === "up" ? [{ sortOrder: "desc" }, { id: "desc" }] : [{ sortOrder: "asc" }, { id: "asc" }],
    });
    if (!neighbor) return false;
    // Tartib raqamlari bir xil bo'lib qolgan (eski) yozuvlarda ham almashish sezilsin
    const [a, b] = neighbor.sortOrder === lesson.sortOrder ? [lesson.sortOrder + (direction === "up" ? -1 : 1), lesson.sortOrder] : [neighbor.sortOrder, lesson.sortOrder];
    await tx.lesson.update({ where: { id: lesson.id }, data: { sortOrder: a } });
    await tx.lesson.update({ where: { id: neighbor.id }, data: { sortOrder: b } });
    return true;
  });
}

export class LessonOrderError extends Error {}

/** Panel: to'liq yangi tartib (kursning barcha darslari ID lari, kerakli ketma-ketlikda) */
export async function reorderLessons(productId: number, ids: number[]): Promise<void> {
  const current = await prisma.lesson.findMany({ where: { productId }, select: { id: true } });
  const known = new Set(current.map((l) => l.id));
  if (ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
    throw new LessonOrderError("Tartib ro'yxati kursning barcha darslarini aynan bir martadan o'z ichiga olishi kerak");
  }
  await prisma.$transaction(ids.map((id, i) => prisma.lesson.update({ where: { id }, data: { sortOrder: i + 1 } })));
}

/** Kursga faol kirish bor (to'langan, bekor qilinmagan va muddati o'tmagan) */
export async function hasCourseAccess(userId: bigint, productId: number): Promise<boolean> {
  const grant = await prisma.accessGrant.findFirst({
    where: { userId, productId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { id: true },
  });
  return !!grant;
}

const CAPTION_LIMIT = 1024;

/** Mijozga yuboriladigan izoh: "<b>3. Dars nomi</b>" + admin izohi (Telegram limiti 1024 belgi) */
export function lessonCaption(lesson: Pick<Lesson, "title" | "caption">, position: number): string {
  const head = `<b>${position}. ${escapeHtml(lesson.title)}</b>`;
  if (!lesson.caption) return head;
  const room = CAPTION_LIMIT - stripHtml(head).length - 2;
  return `${head}\n\n${escapeHtml(truncate(lesson.caption, room))}`;
}

/** file_id yaroqsiz (fayl o'chirilgan, boshqa bot tokeni va h.k.) */
export function isUnavailableFileError(err: unknown): boolean {
  if (!(err instanceof GrammyError) || err.error_code !== 400) return false;
  return /wrong file identifier|file reference|file_id|wrong remote file|FILE_ID_INVALID|file is temporarily unavailable|wrong type of the web page content/i.test(err.description);
}

export function isBlockedError(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 403;
}

/**
 * Darsni Telegram orqali yuboradi — faqat file_id, fayl serverdan o'tmaydi.
 * 429 (flood) va tarmoq xatolarini bot API ga ulangan autoRetry o'zi qayta urinadi.
 */
export async function sendLesson(api: Api, chatId: number | bigint, lesson: Lesson, position: number): Promise<void> {
  const options = {
    caption: lessonCaption(lesson, position),
    parse_mode: "HTML" as const,
    protect_content: config.LESSON_PROTECT_CONTENT,
  };
  try {
    if (lesson.mediaType === "document") await api.sendDocument(Number(chatId), lesson.telegramFileId, options);
    else await api.sendVideo(Number(chatId), lesson.telegramFileId, { ...options, supports_streaming: true });
  } catch (err) {
    if (isUnavailableFileError(err)) {
      // Developer/admin uchun: panelning "Xatoliklar" bo'limiga tushadi
      logger.error({ err, lessonId: lesson.id, productId: lesson.productId }, "dars videosi Telegram'da topilmadi (file_id yaroqsiz)");
    }
    throw err;
  }
}

/** Darsning kursdagi tartib raqami (1 dan) */
export async function lessonPosition(lesson: Pick<Lesson, "id" | "productId" | "sortOrder">): Promise<number> {
  const before = await prisma.lesson.count({
    where: { productId: lesson.productId, OR: [{ sortOrder: { lt: lesson.sortOrder } }, { sortOrder: lesson.sortOrder, id: { lt: lesson.id } }] },
  });
  return before + 1;
}
