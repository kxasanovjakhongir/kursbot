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
import { sendTelegramFile } from "../telegramFile";
import { botUsername } from "../../services/botInfo";
import { safeFileName, sniffFileType } from "../../lib/fileType";
import { ChannelInputError, listKnownChannels, resolveChannelId } from "../../services/channels";
import type { BotRuntime } from "../runtime";
import { clientIp, parseBody, parseId } from "../validate";

// Bot API orqali yuklash limiti — 50 MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

/** Kurs ma'lumotlari (ixtiyoriy). Bo'sh satr — maydon tozalanadi */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));
const courseFields = {
  duration: text(60),
  lessonsCount: z.number().int().min(1).max(10_000).nullable().optional(),
  audience: text(600),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Sana formati: YYYY-MM-DD")
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? new Date(`${v}T00:00:00Z`) : null)),
  teacher: text(800),
  benefits: text(1500),
  program: text(3000),
};

const updateSchema = z.object({
  ...courseFields,
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(900).optional(),
  price: z.number().int().min(0).max(1_000_000_000).optional(),
  oldPrice: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  // Kanal ID yoki havolasi (t.me/+..., @kanal, post havolasi) — resolveChannelId ID ga aylantiradi
  channelId: z.string().trim().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
  // Kanalda qolish muddati (kun), null — muddatsiz. Faqat yangi xaridlarga ta'sir qiladi
  accessDays: z.number().int().min(1).max(3650).nullable().optional(),
});

const createSchema = z
  .object({
    // Kod deeplink'da ishlatiladi (t.me/bot?start=<kod>_<manba>), shuning uchun "_" mumkin emas
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]{1,20}$/, "Kod: 1–20 ta lotin harfi, raqam yoki «-» (masalan: 5b, ingliz-tili)"),
    title: z.string().trim().min(1).max(100),
    description: z.string().max(900).default(""),
    price: z.number().int().min(0).max(1_000_000_000),
    oldPrice: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
    type: z.enum(["channel", "bundle"]),
    channelId: z.string().trim().max(200).nullable().default(null),
    bundleCodes: z.array(z.string().trim().toLowerCase()).max(10).default([]),
    isActive: z.boolean().default(false),
    accessDays: z.number().int().min(1).max(3650).nullable().default(null),
    ...courseFields,
  })
  .strict();

/**
 * Kanal havolasi/ID sini tekshirib, ID ga aylantiradi. Bot kanalda admin va
 * "foydalanuvchilarni taklif qilish" huquqiga ega bo'lishi kerak (TZ 11.3). Bo'sh qiymat — null.
 */
async function checkedChannel(rt: BotRuntime, input: string | null): Promise<bigint | null> {
  if (!input) return null;
  let id: string;
  try {
    id = await resolveChannelId(rt.api, input);
  } catch (err) {
    if (err instanceof ChannelInputError) throw new HttpError(400, err.message);
    throw err;
  }
  const me = await rt.api.getMe();
  const member = await rt.api.getChatMember(Number(id), me.id).catch(() => null);
  if (!member) throw new HttpError(400, "Kanal topilmadi. Botni kanalga admin qilib qo'shing va ID ni tekshiring");
  if (member.status !== "administrator" || !member.can_invite_users) {
    throw new HttpError(400, "Bot bu kanalda admin emas yoki «foydalanuvchilarni taklif qilish» huquqi yo'q");
  }
  return BigInt(id);
}

/** Mahsulotlar: narx, tavsif, kanal va tanishtiruv videosi (TZ 3.1) */
export function productsRouter(rt: BotRuntime): Router {
  const r = Router();

  r.get("/", async (_req, res) => {
    const items = await prisma.product.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
    res.json({ items, botUsername: await botUsername(rt.api) });
  });

  /** Bot admin bo'lgan kanallar — panelda tanlash uchun */
  r.get("/channels", async (_req, res) => {
    res.json({ items: await listKnownChannels() });
  });

  r.post("/", async (req, res) => {
    const body = parseBody(createSchema, req);
    if (await prisma.product.findUnique({ where: { code: body.code } })) throw new HttpError(409, `«${body.code}» kodli mahsulot allaqachon bor`);
    // Kampaniya linki kodi bilan bir xil bo'lsa, t.me/bot?start=<kod> qaysi biriga olib borishi noaniq bo'lardi
    if (await prisma.campaignLink.findUnique({ where: { code: body.code } })) throw new HttpError(409, `«${body.code}» kodi kampaniya linkida ishlatilgan`);

    let bundleCodes: string[] = [];
    if (body.type === "bundle") {
      bundleCodes = [...new Set(body.bundleCodes)];
      const parts = await prisma.product.findMany({ where: { code: { in: bundleCodes }, type: "channel", deletedAt: null } });
      if (bundleCodes.length < 2 || parts.length !== bundleCodes.length) {
        throw new HttpError(400, "To'plamga kamida 2 ta mavjud (kanalli) mahsulotni tanlang");
      }
    }
    const channelId = body.type === "channel" ? await checkedChannel(rt, body.channelId) : null;
    const last = await prisma.product.aggregate({ _max: { sortOrder: true } });

    const created = await prisma.product.create({
      data: {
        code: body.code,
        title: body.title,
        description: body.description,
        price: body.price,
        oldPrice: body.oldPrice,
        type: body.type,
        channelId,
        bundleCodes,
        isActive: body.isActive,
        accessDays: body.accessDays,
        duration: body.duration ?? null,
        lessonsCount: body.lessonsCount ?? null,
        audience: body.audience ?? null,
        startDate: body.startDate ?? null,
        teacher: body.teacher ?? null,
        benefits: body.benefits ?? null,
        program: body.program ?? null,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
      },
    });
    await logActivity(currentUser(req).id, "CREATE_PRODUCT", `${created.title} (${created.code})`, clientIp(req));
    res.status(201).json(created);
  });

  /**
   * O'chirish. Hech kim ishlatmagan mahsulot bazadan butunlay o'chiriladi. Buyurtmasi bor bo'lsa —
   * "yumshoq" o'chiriladi: buyurtmalar, tushum va xaridorlarning kirishi saqlanadi, mahsulot esa
   * panel va botdan yo'qoladi, kodi bo'shatiladi (shu kod bilan yangi kurs ochish mumkin).
   * To'lanmagan ochiq buyurtmalar bekor qilinadi; chek tekshirilayotgan bo'lsa — avval ko'rib chiqish kerak.
   */
  r.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const product = await prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { orders: true, grants: true, promos: true } } },
    });
    if (!product) throw new HttpError(404, "Mahsulot topilmadi");
    const bundles = await prisma.product.findMany({ where: { bundleCodes: { has: product.code }, deletedAt: null }, select: { title: true } });
    if (bundles.length) throw new HttpError(409, `Bu mahsulot to'plam tarkibida: ${bundles.map((b) => b.title).join(", ")}. Avval to'plamni o'chiring`);
    const reviewing = await prisma.order.count({ where: { productId: id, status: "receipt_sent" } });
    if (reviewing) throw new HttpError(409, `Bu mahsulot bo'yicha ${reviewing} ta chek tekshirilmoqda. Avval ularni «Cheklar» bo'limida ko'rib chiqing`);

    const { orders, grants, promos } = product._count;
    if (orders + grants + promos === 0) {
      await prisma.product.delete({ where: { id } });
    } else {
      await prisma.$transaction([
        prisma.order.updateMany({
          where: { productId: id, status: { in: ["new", "rejected"] } },
          data: { status: "cancelled", cancelledAt: new Date(), cancelledById: currentUser(req).id, cancelReason: "Kurs o'chirildi" },
        }),
        prisma.product.update({
          where: { id },
          data: { deletedAt: new Date(), isActive: false, code: `${product.code}~${id}` },
        }),
        prisma.campaignLink.updateMany({ where: { productId: id }, data: { isActive: false } }),
      ]);
    }
    await logActivity(currentUser(req).id, "DELETE_PRODUCT", `${product.title} (${product.code})${orders ? ` — ${orders} ta buyurtma tarixi saqlandi` : ""}`, clientIp(req));
    res.json({ ok: true });
  });

  r.put("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const body = parseBody(updateSchema, req);
    const before = await prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new HttpError(404, "Mahsulot topilmadi");

    const channelId = body.channelId === undefined ? undefined : await checkedChannel(rt, body.channelId);

    // Narx o'zgarsa ochiq buyurtmalar eski narxda qoladi (BR-03)
    const updated = await prisma.product.update({ where: { id }, data: { ...body, channelId } });
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
    const kind = sniffFileType(file.buffer);
    if (kind !== "mp4" && kind !== "webm") throw new HttpError(400, "Fayl video emas (mazmuni formatga mos kelmadi)");

    const storageChat = (await getAdminGroupId()) ?? config.SUPERADMIN_IDS[0];
    if (!storageChat) throw new HttpError(400, "Video yuklash uchun admin guruhi (/setgroup) yoki SUPERADMIN_IDS kerak");

    const msg = await rt.api.sendVideo(Number(storageChat), new InputFile(file.buffer, safeFileName(file.originalname, `video.${kind}`)), {
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
    await sendTelegramFile(res, rt.api, product.videoFileId, "video/mp4");
  });

  return r;
}
