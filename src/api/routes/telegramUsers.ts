import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../../db";
import { notifyUser } from "../../bot/notify";
import { label, translate } from "../../i18n";
import { logActivity } from "../../services/activity";
import { banUser, KickFailedError, revokeGrantById, setGrantExpiry, unbanUser } from "../../services/membership";
import { searchUsers, userLang, type UserFilter } from "../../services/users";
import { EXPORT_MIME, exportFileName, prepareUserExport, type ExportFormat } from "../../services/export";
import { logger } from "../../lib/logger";
import { formatDate, formatDateTime, formatSum } from "../../lib/format";
import { clickEnabled, paymeEnabled } from "../../config";
import { botUsername } from "../../services/botInfo";
import { createAdminPayOrder } from "../../services/orders";
import { grantTrial } from "../../services/access";
import { checkOwnership } from "../../services/products";
import { displayCourseName } from "../../services/settings";
import { clickCheckoutUrl } from "../../services/payments/click";
import { returnUrl } from "../../services/payments/common";
import { paymeCheckoutUrl } from "../../services/payments/payme";
import { assertPermission, currentUser } from "../auth";
import { HttpError } from "../errors";
import type { BotRuntime } from "../runtime";
import { clientIp, paged, pagination, parseBigId, parseBody, parseQuery } from "../validate";

const yesNo = z.enum(["yes", "no"]).optional().transform((v) => (v === undefined ? undefined : v === "yes"));

const filterQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "blocked", "banned"]).default("all"),
  productId: z.coerce.number().int().positive().optional(),
  source: z.string().trim().max(40).optional(),
  campaign: z.string().trim().max(80).optional(),
  purchased: yesNo,
  registered: yesNo,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  // Shu kursni sotib olganlar va shu holatdagi buyurtmasi borlar (to'lov holati)
  boughtProductId: z.coerce.number().int().positive().optional(),
  paymentStatus: z.enum(["new", "receipt_sent", "rejected", "approved", "joined", "expired", "cancelled", "refunded"]).optional(),
});
const listQuery = pagination.merge(filterQuery);

/** Bo'sh qiymatli filtrlar (panel "" yuborishi mumkin) — filtr yo'q deb qaraladi */
const toFilter = (q: z.infer<typeof filterQuery>): UserFilter => ({ ...q, source: q.source || undefined, campaign: q.campaign || undefined });

// /export/excel, /export/word ham qabul qilinadi
const FORMAT_ALIAS: Record<string, ExportFormat> = { xlsx: "xlsx", excel: "xlsx", docx: "docx", word: "docx", pdf: "pdf" };


const banSchema = z.object({ removeFromChannels: z.boolean().default(true) }).strict();

// Aniq sana (ISO) yoki bugundan boshlab kunlar; null — muddatsiz
const expirySchema = z
  .object({
    expiresAt: z.coerce.date().nullable().optional(),
    days: z.number().int().min(1).max(3650).optional(),
  })
  .strict()
  .refine((b) => (b.expiresAt === undefined) !== (b.days === undefined), "expiresAt yoki days dan bittasini yuboring");

const trialSchema = z
  .object({
    productId: z.number().int().positive(),
    days: z.number().int().min(1, "Kamida 1 kun").max(7, "Sinov ko'pi bilan 7 kun"),
  })
  .strict();

const payLinkSchema = z
  .object({
    productId: z.number().int().positive(),
    amount: z.number().int("Narx butun son bo'lsin").min(1000, "Narx kamida 1 000 so'm").max(100_000_000, "Narx juda katta"),
    days: z.number().int().min(1).max(30).default(7),
  })
  .strict();

const messageSchema = z.object({ text: z.string().trim().min(1, "Xabar matni bo'sh").max(3500) });

async function findUser(id: bigint) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new HttpError(404, "Foydalanuvchi topilmadi");
  return user;
}

export function telegramUsersRouter(rt: BotRuntime): Router {
  const r = Router();

  /** Export og'ir amal — har bir panel foydalanuvchisiga daqiqasiga 10 ta */
  const exportLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => `export:${req.panelUser?.id ?? "anon"}`,
    message: { error: "Juda ko'p export so'rovi. Bir daqiqadan keyin qayta urinib ko'ring.", details: { code: "rate_limited" } },
  });


  r.get("/", async (req, res) => {
    const { page, pageSize, ...filter } = parseQuery(listQuery, req);
    const { items, total } = await searchUsers({ ...toFilter(filter), page, pageSize });
    res.json(paged(items, total, page, pageSize));
  });

  /**
   * Foydalanuvchilarni yuklab olish (xlsx | docx | pdf) — ro'yxatdagi filtrlarning aynan o'zi.
   * Alohida ruxsat ("users.export"). Fayl bo'laklab hosil qilinadi va javobga oqim bilan yoziladi.
   */
  r.get("/export/:format", exportLimiter, async (req, res) => {
    assertPermission(req, "users.export");
    const format = FORMAT_ALIAS[String(req.params.format).toLowerCase()];
    if (!format) throw new HttpError(400, "Format: xlsx, docx yoki pdf");
    const filter = toFilter(parseQuery(filterQuery, req));
    // Statistika so'rovlari shu yerda — xato bo'lsa hali sarlavhalar yuborilmagan, oddiy JSON xato qaytadi
    const { summary, write } = await prepareUserExport(format, filter);
    const name = exportFileName(format, summary.generatedAt);
    res.setHeader("Content-Type", EXPORT_MIME[format]);
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Export-Total", String(summary.total));
    const started = Date.now();
    try {
      await write(res);
    } catch (err) {
      // Fayl yarmida uzildi: JSON yuborib bo'lmaydi — ulanish yopiladi, brauzer yuklashni xato deb ko'rsatadi
      logger.error({ err, format, total: summary.total }, "export yozishda xatolik");
      res.destroy();
      return;
    }
    await logActivity(
      currentUser(req).id,
      "EXPORT_USERS",
      `Foydalanuvchilar eksporti (${format}): ${summary.total} ta — ${summary.filters.join("; ")} (${Date.now() - started} ms)`,
      clientIp(req),
    );
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

  /** «To'lov havolasi» oynasi uchun: sotuvdagi kurslar va joriy narxi */
  r.get("/pay-products", async (_req, res) => {
    const items = await prisma.product.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, title: true, price: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    res.json({ items });
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
    // Cheklov sababli yopilgan kanal kirishlari tiklanadi — link kurs sahifasidagi «🔗 Kanal havolasi» dan olinadi
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

  /**
   * «To'lov havolasi»: admin kurs va narxni tanlaydi — shu summa bilan buyurtma ochiladi va bot foydalanuvchiga
   * Click / Payme tugmalarini yuboradi. To'lansa, buyurtma avtomatik tasdiqlanib kanal havolasi boradi.
   */
  r.post("/:id/pay-link", async (req, res) => {
    assertPermission(req, "users.manage");
    const { productId, amount, days } = parseBody(payLinkSchema, req);
    const user = await findUser(parseBigId(req.params.id));
    const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!product) throw new HttpError(404, "Kurs topilmadi");
    const own = await checkOwnership(user.id, product);
    if (own.kind === "owned") throw new HttpError(409, "Bu foydalanuvchi bu kursni allaqachon sotib olgan");

    const result = await createAdminPayOrder(user.id, product, amount, days);
    if (result.kind === "no_online") throw new HttpError(409, "Payme / Click sozlanmagan");
    if (result.kind === "under_review") throw new HttpError(409, `Buyurtma #${result.order!.id} bo'yicha chek tekshirilmoqda — avval uni ko'rib chiqing`);
    if (result.kind === "paying") throw new HttpError(409, `Buyurtma #${result.order!.id} bo'yicha to'lov hozir jarayonda — birozdan keyin qayta urinib ko'ring`);
    if (result.kind !== "ok") throw new HttpError(409, "Buyurtma ochilmadi");
    const { order } = result;

    const lang = await userLang(user);
    const back = returnUrl((await botUsername(rt.api)) ?? undefined);
    const clickUrl = clickEnabled() ? clickCheckoutUrl(order.id, order.amount, { returnUrl: back }) : null;
    const paymeUrl = paymeEnabled() ? paymeCheckoutUrl(order.id, order.amount, { returnUrl: back, lang }) : null;
    const buttons = [
      clickUrl && [{ text: await translate(lang, "btn_pay_click"), url: clickUrl }],
      paymeUrl && [{ text: await translate(lang, "btn_pay_payme"), url: paymeUrl }],
    ].filter((b): b is { text: string; url: string }[] => !!b);

    const text = await translate(lang, "admin_pay_link", {
      ism: user.firstName ?? "",
      mahsulot: await displayCourseName(product.title),
      summa: formatSum(order.amount),
      muddat: formatDateTime(order.expiresAt),
    });
    const sent = await notifyUser(rt.api, user, "order", text, { reply_markup: { inline_keyboard: buttons } });
    await logActivity(
      currentUser(req).id,
      "SEND_PAY_LINK",
      `To'lov havolasi ${sent ? "yuborildi" : "yetkazilmadi (bloklagan)"}: ${user.telegramId}, ${product.title}, ${formatSum(order.amount)}, buyurtma #${order.id}`,
      clientIp(req),
    );
    res.json({ delivered: !!sent, orderId: order.id.toString(), amount: order.amount, expiresAt: order.expiresAt, clickUrl, paymeUrl });
  });

  // «Sinov uchun ochish»: o'ylab turgan mijozga 1–7 kunga kanal; link faqat shu odam uchun (qo'shilish so'rovi)
  r.post("/:id/trial", async (req, res) => {
    assertPermission(req, "users.manage");
    const { productId, days } = parseBody(trialSchema, req);
    const user = await findUser(parseBigId(req.params.id));
    if (user.isBanned) throw new HttpError(409, "Foydalanuvchi cheklangan — avval cheklovni olib tashlang");
    const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!product) throw new HttpError(404, "Kurs topilmadi");

    const result = await grantTrial(rt.api, user, product, days);
    if (result.kind === "owned") throw new HttpError(409, "Bu foydalanuvchi bu kursni allaqachon sotib olgan");
    if (result.kind === "no_channel") throw new HttpError(409, "Bu kursga yopiq kanal ulanmagan");
    const links = result.grants.filter((g) => g.inviteLink);
    if (links.length === 0) throw new HttpError(502, "Kanal havolasi yaratilmadi — bot kanalda admin ekanini tekshiring");

    const lang = await userLang(user);
    const name = await displayCourseName(product.title);
    const buttons =
      links.length === 1
        ? [[{ text: await translate(lang, "approved_button"), url: links[0].inviteLink! }]]
        : await Promise.all(links.map(async (g) => [{ text: label(lang, "btn_join", { mahsulot: await displayCourseName(g.product.title) }), url: g.inviteLink! }]));
    const text = await translate(lang, "trial_granted", { ism: user.firstName ?? "", mahsulot: name, muddat: formatDateTime(result.expiresAt) });
    const sent = await notifyUser(rt.api, user, "success", text, { reply_markup: { inline_keyboard: buttons } });
    await logActivity(
      currentUser(req).id,
      "GRANT_TRIAL",
      `Sinov uchun ochildi${sent ? "" : " (xabar yetkazilmadi)"}: ${user.telegramId}, ${product.title}, ${days} kun, ${formatDateTime(result.expiresAt)} gacha`,
      clientIp(req),
    );
    res.json({ delivered: !!sent, expiresAt: result.expiresAt, links: links.map((g) => ({ title: g.product.title, url: g.inviteLink })) });
  });

  return r;
}
