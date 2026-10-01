import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { logActivity } from "../../services/activity";
import { deleteLesson, getLessonCourse, LESSON_CAPTION_MAX, LESSON_TITLE_MAX, LessonOrderError, listLessonCourses, reorderLessons, updateLesson } from "../../services/lessons";
import { currentUser } from "../auth";
import { HttpError } from "../errors";
import { clientIp, parseBody, parseId, parseQuery } from "../validate";

const listQuery = z.object({ productId: z.coerce.number().int().positive().optional() });

/** Bo'sh satr — maydon tozalanadi */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));

const updateSchema = z
  .object({
    title: z.string().trim().min(1, "Dars nomi bo'sh").max(LESSON_TITLE_MAX).optional(),
    caption: optionalText(LESSON_CAPTION_MAX),
    description: optionalText(2000),
  })
  .strict();

const reorderSchema = z.object({ productId: z.number().int().positive(), ids: z.array(z.number().int().positive()).max(1000) }).strict();

/**
 * Kurs darslari (videolar). Videoning o'zi botga yuboriladi/forward qilinadi (Telegram file_id) —
 * panel ro'yxat, nom/izoh, tartib va o'chirishni boshqaradi. Fayl file_id siz hech qachon tashqariga chiqmaydi.
 */
export function lessonsRouter(): Router {
  const r = Router();

  r.get("/courses", async (_req, res) => {
    res.json({ items: await listLessonCourses() });
  });

  r.get("/", async (req, res) => {
    const { productId } = parseQuery(listQuery, req);
    const items = await prisma.lesson.findMany({
      where: { ...(productId ? { productId } : {}), product: { deletedAt: null } },
      orderBy: [{ productId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
      // file_id panelga kerak emas — tashqariga chiqarilmaydi
      select: {
        id: true,
        productId: true,
        title: true,
        caption: true,
        description: true,
        mediaType: true,
        fileName: true,
        mimeType: true,
        fileSize: true,
        duration: true,
        width: true,
        height: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
        product: { select: { title: true } },
      },
      take: 2000,
    });
    res.json({ items });
  });

  r.put("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const body = parseBody(updateSchema, req);
    const updated = await updateLesson(id, body);
    if (!updated) throw new HttpError(404, "Dars topilmadi");
    await logActivity(currentUser(req).id, "UPDATE_LESSON", `Dars #${id}: ${Object.keys(body).join(", ")} — ${updated.title}`, clientIp(req));
    res.json({ id: updated.id, title: updated.title, caption: updated.caption, description: updated.description });
  });

  r.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const lesson = await prisma.lesson.findUnique({ where: { id }, select: { title: true, product: { select: { title: true } } } });
    if (!lesson || !(await deleteLesson(id))) throw new HttpError(404, "Dars topilmadi");
    await logActivity(currentUser(req).id, "DELETE_LESSON", `${lesson.product.title}: «${lesson.title}» o'chirildi`, clientIp(req));
    res.json({ ok: true });
  });

  /** Yangi tartib: kursning barcha darslari ID lari kerakli ketma-ketlikda */
  r.post("/reorder", async (req, res) => {
    const { productId, ids } = parseBody(reorderSchema, req);
    const course = await getLessonCourse(productId);
    if (!course) throw new HttpError(404, "Kurs topilmadi");
    try {
      await reorderLessons(course.id, ids);
    } catch (err) {
      if (err instanceof LessonOrderError) throw new HttpError(400, err.message);
      throw err;
    }
    await logActivity(currentUser(req).id, "REORDER_LESSONS", `${course.title}: darslar tartibi o'zgartirildi`, clientIp(req));
    res.json({ ok: true });
  });

  return r;
}
