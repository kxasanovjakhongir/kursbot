import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { notifyUser } from "../../bot/notify";
import { translate } from "../../i18n";
import { logActivity } from "../../services/activity";
import { banUser, KickFailedError, revokeGrantById, setGrantExpiry, unbanUser } from "../../services/membership";
import { searchUsers, userLang } from "../../services/users";
import { formatDate } from "../../lib/format";
import { assertPermission, currentUser } from "../auth";
import { HttpError } from "../errors";
import type { BotRuntime } from "../runtime";
import { clientIp, paged, pagination, parseBigId, parseBody, parseQuery } from "../validate";

const yesNo = z.enum(["yes", "no"]).optional().transform((v) => (v === undefined ? undefined : v === "yes"));

const listQuery = pagination.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "blocked", "banned"]).default("all"),
  productId: z.coerce.number().int().positive().optional(),
  source: z.string().trim().max(40).optional(),
  campaign: z.string().trim().max(80).optional(),
  purchased: yesNo,
  registered: yesNo,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const banSchema = z.object({ removeFromChannels: z.boolean().default(true) }).strict();

// Aniq sana (ISO) yoki bugundan boshlab kunlar; null — muddatsiz
const expirySchema = z
  .object({
    expiresAt: z.coerce.date().nullable().optional(),
    days: z.number().int().min(1).max(3650).optional(),
  })
  .strict()
  .refine((b) => (b.expiresAt === undefined) !== (b.days === undefined), "expiresAt yoki days dan bittasini yuboring");

const messageSchema = z.object({ text: z.string().trim().min(1, "Xabar matni bo'sh").max(3500) });

async function findUser(id: bigint) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new HttpError(404, "Foydalanuvchi topilmadi");
  return user;
}

export function telegramUsersRouter(rt: BotRuntime): Router {
  const r = Router();

  r.get("/", async (req, res) => {
    const query = parseQuery(listQuery, req);
    const { items, total } = await searchUsers({ ...query, source: query.source || undefined, campaign: query.campaign || undefined });
    const { page, pageSize } = query;
    res.json(paged(items, total, page, pageSize));
  });

  /** Filtr variantlari: kurslar, manbalar, kampaniyalar (bazadan) */
  r.get("/filters", async (_req, res) => {
    const [products, sources, campaigns] = await Promise.all([
      prisma.product.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, title: true } }),
      prisma.user.findMany({ where: { firstSource: { not: null } }, distinct: ["firstSource"], select: { firstSource: true }, take: 100 }),
      prisma.campaignLink.findMany({ where: { campaign: { not: null } }, distinct: ["campaign"], select: { campaign: true }, take: 100 }),
    ]);
    res.json({
      products,
      sources: sources.map((s) => s.firstSource).filter((s): s is string => !!s),
      campaigns: campaigns.map((c) => c.campaign).filter((c): c is string => !!c),
    });
  });

  r.get("/:id", async (req, res) => {
    const id = parseBigId(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        orders: { include: { product: { select: { title: true, code: true } } }, orderBy: { createdAt: "desc" }, take: 20 },
        // Barcha kirishlar (bekor qilinganlari ham) — panelda tarix va tiklash uchun
        grants: { include: { product: { select: { title: true, channelId: true } } }, orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }] },
        _count: { select: { messages: true, notifications: true } },
      },
    });
    if (!user) throw new HttpError(404, "Foydalanuvchi topilmadi");
    res.json(user);
  });

  r.get("/:id/messages", async (req, res) => {
    const id = parseBigId(req.params.id);
    const { page, pageSize } = parseQuery(pagination, req);
    const where = { userId: id };
    const [items, total] = await Promise.all([
      prisma.message.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.message.count({ where }),
    ]);
    res.json(paged(items, total, page, pageSize));
  });

  // ---------- Boshqaruv (ADMIN va SUPER_ADMIN) ----------

  /** Cheklash: bot foydalanuvchiga javob bermaydi, broadcast yuborilmaydi */
  r.post("/:id/ban", async (req, res) => {
    assertPermission(req, "users.manage");
    // Body'siz so'rov (eski klientlar) — kanallardan ham chiqariladi
    const { removeFromChannels } = banSchema.parse(req.body ?? {});
    const user = await findUser(parseBigId(req.params.id));
    const { user: updated, channels } = await banUser(rt.api, user.id, removeFromChannels);
    const extra = removeFromChannels ? `, kanallardan chiqarildi: ${channels.removed}${channels.failed.length ? `, chiqarib bo'lmadi: ${channels.failed.join(", ")}` : ""}` : "";
    await logActivity(currentUser(req).id, "BAN_USER", `Foydalanuvchi cheklandi: ${user.telegramId} (${user.firstName ?? "—"})${extra}`, clientIp(req));
    res.json({ id: updated.id, isBanned: updated.isBanned, bannedAt: updated.bannedAt, channels });
  });

  r.post("/:id/unban", async (req, res) => {
    assertPermission(req, "users.manage");
    const user = await findUser(parseBigId(req.params.id));
    // Cheklov sababli yopilgan kanal kirishlari tiklanadi — link "Mening xaridlarim" dan olinadi
    const { user: updated, restored } = await unbanUser(user.id);
    await logActivity(
      currentUser(req).id,
      "UNBAN_USER",
      `Cheklov olib tashlandi: ${user.telegramId} (${user.firstName ?? "—"})${restored ? `, tiklangan kirishlar: ${restored}` : ""}`,
      clientIp(req),
    );
    res.json({ id: updated.id, isBanned: updated.isBanned, bannedAt: updated.bannedAt, restored });
  });

  // ---------- Yopiq kanal kirishlari ----------

  async function findGrant(userId: bigint, grantId: bigint) {
    const grant = await prisma.accessGrant.findFirst({ where: { id: grantId, userId }, include: { product: true } });
    if (!grant) throw new HttpError(404, "Kirish topilmadi");
    return grant;
  }

  /** Kanaldan chiqarish: kirish bekor qilinadi, foydalanuvchiga xabar boradi */
  r.post("/:id/grants/:grantId/revoke", async (req, res) => {
    assertPermission(req, "users.manage");
    const user = await findUser(parseBigId(req.params.id));
    const grant = await findGrant(user.id, parseBigId(req.params.grantId));
    if (grant.revokedAt) throw new HttpError(409, "Kirish allaqachon bekor qilingan");
    try {
      await revokeGrantById(rt.api, grant.id, "removed");
    } catch (err) {
      if (err instanceof KickFailedError) throw new HttpError(502, err.message);
      throw err;
    }
    await logActivity(currentUser(req).id, "REMOVE_FROM_CHANNEL", `${grant.product.title}: ${user.telegramId} (${user.firstName ?? "—"}) kanaldan chiqarildi`, clientIp(req));
    res.json({ ok: true });
  });

  /**
   * Kanalda qolish muddati: sana yoki kun (bugundan), null — muddatsiz.
   * Bekor qilingan kirishga muddat berilsa — kirish tiklanadi.
   */
  r.put("/:id/grants/:grantId/expiry", async (req, res) => {
    assertPermission(req, "users.manage");
    const body = parseBody(expirySchema, req);
    const user = await findUser(parseBigId(req.params.id));
    const grant = await findGrant(user.id, parseBigId(req.params.grantId));
    const expiresAt = body.days !== undefined ? new Date(Date.now() + body.days * 86400_000) : (body.expiresAt ?? null);
    if (expiresAt && expiresAt.getTime() <= Date.now()) throw new HttpError(400, "Muddat kelajakdagi sana bo'lishi kerak");
    if (grant.revokedAt && user.isBanned) throw new HttpError(409, "Foydalanuvchi cheklangan — avval cheklovni olib tashlang");
    if (grant.revokedAt) {
      const active = await prisma.accessGrant.findFirst({ where: { userId: user.id, productId: grant.productId, revokedAt: null } });
      if (active) throw new HttpError(409, "Bu kanal uchun boshqa faol kirish bor — o'shaning muddatini o'zgartiring");
    }
    const updated = await setGrantExpiry(rt.api, grant.id, expiresAt);
    await logActivity(
      currentUser(req).id,
      "UPDATE_ACCESS_EXPIRY",
      `${grant.product.title}: ${user.telegramId} — ${expiresAt ? `${formatDate(expiresAt)} gacha` : "muddatsiz"}${grant.revokedAt ? " (kirish tiklandi)" : ""}`,
      clientIp(req),
    );
    res.json(updated);
  });

  /** Bitta foydalanuvchiga xabar ("💬 Admin xabari"), bildirishnomalar tarixiga ham yoziladi */
  r.post("/:id/message", async (req, res) => {
    assertPermission(req, "users.manage");
    const { text } = parseBody(messageSchema, req);
    const user = await findUser(parseBigId(req.params.id));
    const body = await translate(await userLang(user), "admin_message", { matn: text });
    const sent = await notifyUser(rt.api, user, "message", body);
    await logActivity(
      currentUser(req).id,
      "SEND_USER_MESSAGE",
      `Xabar ${sent ? "yuborildi" : "yetkazilmadi (bloklagan)"}: ${user.telegramId}`,
      clientIp(req),
    );
    res.json({ delivered: !!sent });
  });

  return r;
}
