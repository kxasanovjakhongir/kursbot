import { Router } from "express";
import { safeFileName, sniffFileType } from "../../lib/fileType";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../../db";
import { logActivity } from "../../services/activity";
import { BroadcastInputError, countRecipients, createBroadcast, enqueueBroadcast } from "../../services/broadcast";
import { currentUser } from "../auth";
import { HttpError } from "../errors";
import type { BotRuntime } from "../runtime";
import { clientIp, paged, pagination, parseId, parseQuery } from "../validate";

// Bot API orqali yuklash limiti — 50 MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

const MIME_BY_TYPE = {
  photo: /^image\/(jpeg|png|webp)$/,
  video: /^video\/(mp4|quicktime|webm)$/,
  document: /.*/,
} as const;

const splitRecipients = (s: string | undefined) => (s ?? "").split(/[\s,;]+/).filter(Boolean);

const AUDIENCES = ["all", "active", "specific", "buyers", "non_buyers", "admins", "product"] as const;

const audienceSchema = z
  .object({
    audience: z.enum(AUDIENCES),
    recipients: z.string().max(20_000).optional(),
    productId: z.coerce.number().int().positive().optional(),
  })
  .refine((v) => v.audience !== "product" || v.productId !== undefined, { message: "Mahsulotni tanlang", path: ["productId"] });

const createSchema = audienceSchema.and(
  z.object({
    messageType: z.enum(["text", "photo", "video", "document"]),
    text: z.string().max(4096).optional(),
    idempotencyKey: z.string().uuid(),
  }),
);

export function broadcastRouter(rt: BotRuntime): Router {
  const r = Router();

  /** "Mahsulot egalari" auditoriyasi uchun tanlov ro'yxati (ADMIN ham ko'radi — narx va kanalsiz) */
  r.get("/products", async (_req, res) => {
    res.json(await prisma.product.findMany({ where: { deletedAt: null }, select: { id: true, title: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }));
  });

  /** Tasdiqlash oynasi uchun: "5 240 ta foydalanuvchiga yuborilsinmi?" */
  r.get("/recipients-count", async (req, res) => {
    const q = parseQuery(audienceSchema, req);
    try {
      res.json(await countRecipients({ audience: q.audience, recipients: splitRecipients(q.recipients), productId: q.productId ?? null }));
    } catch (err) {
      if (err instanceof BroadcastInputError) throw new HttpError(400, err.message);
      throw err;
    }
  });

  r.post("/", upload.single("file"), async (req, res) => {
    const body = createSchema.parse(req.body);
    const me = currentUser(req);
    if (body.messageType !== "text" && body.text && body.text.length > 1024) {
      throw new HttpError(400, "Media izohi (caption) 1024 belgidan oshmasligi kerak");
    }
    const file = req.file;
    if (body.messageType !== "text") {
      if (!file) throw new HttpError(400, "Fayl yuklanmagan");
      if (!MIME_BY_TYPE[body.messageType].test(file.mimetype)) throw new HttpError(400, `Fayl turi mos emas: ${file.mimetype}`);
      // Rasm va video mazmuni ham tekshiriladi (hujjat — istalgan tur)
      const kind = sniffFileType(file.buffer);
      if (body.messageType === "photo" && kind !== "jpeg" && kind !== "png" && kind !== "webp") throw new HttpError(400, "Fayl rasm emas");
      if (body.messageType === "video" && kind !== "mp4" && kind !== "webm") throw new HttpError(400, "Fayl video emas");
    }
    if (body.audience === "specific" && splitRecipients(body.recipients).length === 0) {
      throw new HttpError(400, "Qabul qiluvchilarni kiriting (Telegram ID yoki @username)");
    }

    try {
      const { broadcast, created, notFound } = await createBroadcast(rt.api, {
        messageType: body.messageType,
        text: body.text ?? null,
        audience: body.audience,
        recipients: splitRecipients(body.recipients),
        productId: body.productId ?? null,
        idempotencyKey: body.idempotencyKey,
        createdById: me.id,
        media: file && body.messageType !== "text" ? { buffer: file.buffer, fileName: safeFileName(file.originalname, "file") } : null,
      });
      if (created) {
        await logActivity(me.id, "CREATE_BROADCAST", `Broadcast #${broadcast.id} yaratildi (${broadcast.total} ta)`, clientIp(req));
        enqueueBroadcast(rt.api);
        await logActivity(me.id, "SEND_BROADCAST", `Broadcast #${broadcast.id} yuborish navbatiga qo'yildi`, clientIp(req));
      }
      res.status(created ? 201 : 200).json({ broadcast, created, notFound });
    } catch (err) {
      if (err instanceof BroadcastInputError) throw new HttpError(400, err.message);
      throw err;
    }
  });

  r.get("/", async (req, res) => {
    const { page, pageSize } = parseQuery(pagination, req);
    const [items, total] = await Promise.all([
      prisma.broadcast.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { createdBy: { select: { id: true, name: true } }, product: { select: { id: true, title: true } } },
      }),
      prisma.broadcast.count(),
    ]);
    res.json(paged(items, total, page, pageSize));
  });

  r.get("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const broadcast = await prisma.broadcast.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, name: true } }, product: { select: { id: true, title: true } } },
    });
    if (!broadcast) throw new HttpError(404, "Broadcast topilmadi");
    const failures = await prisma.broadcastRecipient.findMany({
      where: { broadcastId: id, status: { in: ["failed", "skipped"] } },
      include: { user: { select: { id: true, firstName: true, username: true, telegramId: true } } },
      take: 50,
    });
    const pending = await prisma.broadcastRecipient.count({ where: { broadcastId: id, status: "pending" } });
    res.json({ broadcast, pending, failures });
  });

  return r;
}
