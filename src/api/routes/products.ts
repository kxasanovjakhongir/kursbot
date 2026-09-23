import { Router } from "express";
import multer from "multer";
import { InputFile } from "grammy";
import { z } from "zod";
import { prisma } from "../../db";
import { config } from "../../config";
import { logActivity } from "../../services/activity";
import { getAdminGroupId } from "../../services/settings";
import { currentUser } from "../auth";
import { HttpError } from "../errors";
import type { BotRuntime } from "../runtime";
import { clientIp, parseBody, parseId } from "../validate";

// Bot API orqali yuklash limiti — 50 MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

const updateSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(900).optional(),
  price: z.number().int().min(0).max(1_000_000_000).optional(),
  oldPrice: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  channelId: z
    .string()
    .regex(/^-100\d{5,}$/, "Kanal ID -100 bilan boshlanadi")
    .nullable()
    .optional(),
  isActive: z.boolean().optional(),
});

/** Mahsulotlar: narx, tavsif, kanal va tanishtiruv videosi (TZ 3.1) */
export function productsRouter(rt: BotRuntime): Router {
  const r = Router();

  r.get("/", async (_req, res) => {
    const items = await prisma.product.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
    const me = await rt.api.getMe().catch(() => null);
    res.json({ items, botUsername: me?.username ?? null });
  });

  r.put("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const body = parseBody(updateSchema, req);
    const before = await prisma.product.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, "Mahsulot topilmadi");

    if (body.channelId) {
      // Bot kanalda admin va "foydalanuvchilarni taklif qilish" huquqiga ega bo'lishi kerak (TZ 11.3)
      const me = await rt.api.getMe();
      const member = await rt.api.getChatMember(Number(body.channelId), me.id).catch(() => null);
      if (!member) throw new HttpError(400, "Kanal topilmadi. Botni kanalga admin qilib qo'shing va ID ni tekshiring");
      if (member.status !== "administrator" || !member.can_invite_users) {
        throw new HttpError(400, "Bot bu kanalda admin emas yoki «foydalanuvchilarni taklif qilish» huquqi yo'q");
      }
    }

    // Narx o'zgarsa ochiq buyurtmalar eski narxda qoladi (BR-03)
    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...body,
        channelId: body.channelId === undefined ? undefined : body.channelId === null ? null : BigInt(body.channelId),
      },
    });
    const changed = Object.keys(body).join(", ");
    await logActivity(currentUser(req).id, "UPDATE_PRODUCT", `${updated.title}: ${changed}`, clientIp(req));
    res.json(updated);
  });

  /**
   * Tanishtiruv videosi: fayl Telegram'ga bir marta yuklanadi (admin guruhiga yoki super adminga),
   * keyin mijozlarga file_id orqali tez yuboriladi (TZ 5.3).
   */
  r.post("/:id/video", upload.single("video"), async (req, res) => {
    const id = parseId(String(req.params.id));
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw new HttpError(404, "Mahsulot topilmadi");
    const file = req.file;
    if (!file) throw new HttpError(400, "Video fayl yuklanmagan");
    if (!/^video\/(mp4|quicktime|webm|x-matroska)$/.test(file.mimetype)) throw new HttpError(400, `Video formati mos emas: ${file.mimetype}`);

    const storageChat = (await getAdminGroupId()) ?? config.SUPERADMIN_IDS[0];
    if (!storageChat) throw new HttpError(400, "Video yuklash uchun admin guruhi (/setgroup) yoki SUPERADMIN_IDS kerak");

    const msg = await rt.api.sendVideo(Number(storageChat), new InputFile(file.buffer, file.originalname), {
      caption: `🎬 Tanishtiruv videosi yangilandi: ${product.title}`,
      supports_streaming: true,
    });
    const updated = await prisma.product.update({ where: { id }, data: { videoFileId: msg.video.file_id } });
    await logActivity(currentUser(req).id, "UPLOAD_VIDEO", `${product.title}: yangi video (${(file.size / 1024 / 1024).toFixed(1)} MB)`, clientIp(req));
    res.json(updated);
  });

  r.delete("/:id/video", async (req, res) => {
    const id = parseId(req.params.id);
    const updated = await prisma.product.update({ where: { id }, data: { videoFileId: null } });
    await logActivity(currentUser(req).id, "UPLOAD_VIDEO", `${updated.title}: video olib tashlandi`, clientIp(req));
    res.json(updated);
  });

  /** Videoni ko'rish uchun proksi (Telegram getFile 20 MB gacha fayllarni beradi) */
  r.get("/:id/video", async (req, res) => {
    const id = parseId(req.params.id);
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product?.videoFileId) throw new HttpError(404, "Video yo'q");
    const file = await rt.api.getFile(product.videoFileId).catch(() => null);
    if (!file?.file_path) throw new HttpError(413, "Video 20 MB dan katta — uni faqat Telegram'da ko'rish mumkin");
    const upstream = await fetch(`https://api.telegram.org/file/bot${rt.api.token}/${file.file_path}`);
    if (!upstream.ok) throw new HttpError(502, "Videoni Telegram'dan olib bo'lmadi");
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(Buffer.from(await upstream.arrayBuffer()));
  });

  return r;
}
