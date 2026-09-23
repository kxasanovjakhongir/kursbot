import { Router } from "express";
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

const createSchema = z.object({
  messageType: z.enum(["text", "photo", "video", "document"]),
  text: z.string().max(4096).optional(),
  audience: z.enum(["all", "active", "specific"]),
  recipients: z.string().max(20_000).optional(),
  idempotencyKey: z.string().uuid(),
});

export function broadcastRouter(rt: BotRuntime): Router {
  const r = Router();

  /** Tasdiqlash oynasi uchun: "5 240 ta foydalanuvchiga yuborilsinmi?" */
  r.get("/recipients-count", async (req, res) => {
    const q = parseQuery(z.object({ audience: z.enum(["all", "active", "specific"]), recipients: z.string().max(20_000).optional() }), req);
    res.json(await countRecipients(q.audience, splitRecipients(q.recipients)));
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
    }
    if (body.audience === "specific" && splitRecipients(body.recipients).length === 0) {
      throw new HttpError(400, "Qabul qiluvchilarni kiriting (Telegram ID yoki @username)");
    }

    try {
      const { broadcast, created, notFound } = await createBroadcast({
        messageType: body.messageType,
        text: body.text ?? null,
        audience: body.audience,
        recipients: splitRecipients(body.recipients),
        idempotencyKey: body.idempotencyKey,
        createdById: me.id,
        media: file && body.messageType !== "text" ? { buffer: file.buffer, fileName: file.originalname } : null,
      });
      if (created) {
        await logActivity(me.id, "CREATE_BROADCAST", `Broadcast #${broadcast.id} yaratildi (${broadcast.total} ta)`, clientIp(req));
        enqueueBroadcast(rt.api, broadcast.id);
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
        include: { createdBy: { select: { id: true, name: true } } },
      }),
      prisma.broadcast.count(),
    ]);
    res.json(paged(items, total, page, pageSize));
  });

  r.get("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const broadcast = await prisma.broadcast.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, name: true } } },
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
