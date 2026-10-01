import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { logActivity } from "../../services/activity";
import { botUsername } from "../../services/botInfo";
import { createLink, LinkInputError, linkStats, linkUrls } from "../../services/campaignLinks";
import { currentUser } from "../auth";
import { HttpError } from "../errors";
import type { BotRuntime } from "../runtime";
import { clientIp, paged, pagination, parseBody, parseId, parseQuery } from "../validate";

const listQuery = pagination.extend({
  productId: z.coerce.number().int().positive().optional(),
  status: z.enum(["all", "active", "disabled"]).default("all"),
});

const createSchema = z
  .object({
    productId: z.number().int().positive(),
    name: z.string().trim().max(100).nullable().default(null),
    // Manba va medium — kichik harfda (statistikada "Instagram" va "instagram" bitta bo'lishi uchun)
    source: z.string().trim().toLowerCase().min(1, "Manbani kiriting").max(40),
    campaign: z.string().trim().max(80).nullable().default(null),
    medium: z.string().trim().toLowerCase().max(40).nullable().default(null),
    code: z.string().trim().toLowerCase().max(32).nullable().default(null),
  })
  .strict();

/** Kampaniya (deep link) havolalari: yaratish, faollik, o'chirish va statistika */
export function linksRouter(rt: BotRuntime): Router {
  const r = Router();

  /** Forma uchun: mahsulotlar va havola sozlamalari */
  r.get("/meta", async (_req, res) => {
    const products = await prisma.product.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, code: true, title: true, isActive: true },
    });
    res.json({ products, botUsername: await botUsername(rt.api) });
  });

  r.get("/", async (req, res) => {
    const { productId, status, page, pageSize } = parseQuery(listQuery, req);
    const where = {
      ...(productId ? { productId } : {}),
      ...(status === "all" ? {} : { isActive: status === "active" }),
    };
    const [items, total, username] = await Promise.all([
      prisma.campaignLink.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { product: { select: { id: true, code: true, title: true, isActive: true } }, createdBy: { select: { name: true } } },
      }),
      prisma.campaignLink.count({ where }),
      botUsername(rt.api),
    ]);
    const stats = await linkStats(items.map((l) => l.id));
    res.json(
      paged(
        items.map((l) => ({ ...l, urls: linkUrls(l.code, username), stats: stats.get(l.id) ?? null })),
        total,
        page,
        pageSize,
      ),
    );
  });

  r.post("/", async (req, res) => {
    const body = parseBody(createSchema, req);
    const me = currentUser(req);
    try {
      const link = await createLink({
        productId: body.productId,
        name: body.name || null,
        source: body.source,
        campaign: body.campaign || null,
        medium: body.medium || null,
        code: body.code || null,
        createdById: me.id,
      });
      await logActivity(me.id, "CREATE_LINK", `${link.code}: ${body.source}${body.campaign ? ` / ${body.campaign}` : ""}`, clientIp(req));
      res.status(201).json({ ...link, urls: linkUrls(link.code, await botUsername(rt.api)) });
    } catch (err) {
      if (err instanceof LinkInputError) throw new HttpError(400, err.message);
      throw err;
    }
  });

  /** O'chirish/yoqish: o'chirilgan link bilan kirgan foydalanuvchiga "havola eskirgan" ko'rsatiladi */
  r.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const { isActive } = parseBody(z.object({ isActive: z.boolean() }).strict(), req);
    const link = await prisma.campaignLink.update({ where: { id }, data: { isActive } });
    await logActivity(currentUser(req).id, "UPDATE_LINK", `${link.code}: ${isActive ? "yoqildi" : "o'chirildi"}`, clientIp(req));
    res.json(link);
  });

  /** Faqat hali ishlatilmagan link o'chiriladi — statistikasi bor link o'chirilmaydi, uni disable qilish kerak */
  r.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const link = await prisma.campaignLink.findUnique({ where: { id }, include: { _count: { select: { visits: true, orders: true, clicks: true } } } });
    if (!link) throw new HttpError(404, "Link topilmadi");
    if (link._count.visits + link._count.orders + link._count.clicks > 0) {
      throw new HttpError(409, "Bu link orqali kirishlar bor — statistika yo'qolmasligi uchun o'chirib bo'lmaydi. Uni o'chiring (disable)");
    }
    await prisma.campaignLink.delete({ where: { id } });
    await logActivity(currentUser(req).id, "DELETE_LINK", link.code, clientIp(req));
    res.json({ ok: true });
  });

  return r;
}
