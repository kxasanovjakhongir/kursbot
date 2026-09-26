import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { Api } from "grammy";
import { z } from "zod";
import { config } from "../../config";
import { LANGS } from "../../i18n";
import { InitDataError, verifyInitData } from "../../lib/telegramAuth";
import { logger } from "../../lib/logger";
import { listNotifications } from "../../services/notifications";
import { PERMISSIONS, can } from "../../services/permissions";
import { trackEvent } from "../../services/events";
import { botUsername } from "../../services/botInfo";
import { recordStart, setLanguage, setNewsEnabled, touchUser, userStats } from "../../services/users";
import { recentLinkProduct, recordLinkVisit, resolveEntry } from "../../services/campaignLinks";
import { HttpError } from "../errors";
import { sendTelegramFile } from "../telegramFile";
import type { BotRuntime } from "../runtime";
import { paged, pagination, parseBody, parseQuery } from "../validate";
import { notificationDto, userDto } from "./dto";
import { buildSession, session, signAppToken, type AppSession } from "./session";

/** Profil + ilova sozlamalari: frontend bitta so'rov bilan hammasini oladi */
async function meResponse(s: AppSession, api: Api) {
  const [username, featured, stats] = await Promise.all([botUsername(api), recentLinkProduct(s.user), userStats(s.user.id)]);
  return {
    user: userDto(s.user),
    role: s.role,
    lang: s.lang,
    permissions: PERMISSIONS.filter((p) => can(s.role, p)),
    stats,
    // Yaqinda reklama linki orqali kelgan darslik — asosiy sahifada birinchi ko'rsatiladi
    featured: featured ? { code: featured.code, title: featured.title } : null,
    app: {
      botUsername: username,
      botUrl: username ? `https://t.me/${username}` : null,
      supportUrl: config.SUPPORT_USERNAME ? `https://t.me/${config.SUPPORT_USERNAME}` : null,
    },
  };
}

// initData HMAC tekshiruvi arzon; IP bo'yicha limit CGNAT ortidagi ko'p foydalanuvchini hisobga oladi
const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Juda ko'p urinish. Birozdan keyin qayta urinib ko'ring.", details: { code: "rate_limited" } },
});

/** Ochiq: Telegram initData orqali kirish */
export function authRouter(rt: BotRuntime): Router {
  const r = Router();

  /**
   * Kirish: frontend Telegram bergan initData ni yuboradi. Backend imzoni bot tokeni bilan tekshiradi,
   * foydalanuvchini topadi yoki yaratadi va Mini App tokenini beradi.
   */
  r.post("/auth/telegram", authLimiter, async (req, res) => {
    const { initData } = parseBody(z.object({ initData: z.string().min(1).max(4096) }), req);
    let verified;
    try {
      verified = verifyInitData(initData, rt.api.token, config.WEB_APP_AUTH_MAX_AGE);
    } catch (err) {
      if (err instanceof InitDataError) {
        logger.warn({ reason: err.message, ip: req.ip }, "Mini App: initData rad etildi");
        throw new HttpError(401, "Telegram ma'lumotlari tasdiqlanmadi", { code: "invalid_init_data" });
      }
      throw err;
    }
    if (verified.user.is_bot) throw new HttpError(403, "Botlar kira olmaydi", { code: "forbidden" });

    const touched = await touchUser(verified.user);
    let user = touched.user;
    const s0 = await buildSession(user);

    // startapp=<kod>: imzolangan initData ichida keladi (soxtalashtirib bo'lmaydi), bot bilan bir xil aniqlanadi
    const entry = await resolveEntry(verified.startParam);
    if (entry.kind === "product") {
      user = await recordStart(user, entry.product.code, entry.source);
      if (entry.link) {
        await recordLinkVisit(user, entry.link, "webapp", touched.isNew);
        user = { ...user, lastLinkId: entry.link.id, lastLinkAt: new Date() };
      }
    }
    await trackEvent(user.id, "webapp_open", {
      isNew: touched.isNew,
      startParam: verified.startParam,
      link: entry.kind === "product" ? (entry.link?.code ?? null) : null,
      product: entry.kind === "product" ? entry.product.code : null,
    });
    res.json({
      token: signAppToken(user),
      me: await meResponse({ ...s0, user }, rt.api),
      // Frontend shu natijaga qarab darslik sahifasini ochadi yoki "havola eskirgan" deydi
      entry: entry.kind === "product" ? { status: "ok", productCode: entry.product.code } : entry.kind === "unavailable" ? { status: "unavailable" } : null,
    });
  });

  return r;
}

/** Kirgan foydalanuvchi: profil, sozlamalar, bildirishnomalar */
export function accountRouter(rt: BotRuntime): Router {
  const r = Router();

  r.get("/me", async (req, res) => {
    res.json(await meResponse(session(req), rt.api));
  });

  // Profil rasmi Bot API orqali: initData dagi photo_url Telegram ichidagi brauzerda ko'pincha ochilmaydi
  r.get("/me/photo", async (req, res) => {
    const photos = await rt.api.getUserProfilePhotos(Number(session(req).user.telegramId), { limit: 1 }).catch(() => null);
    const sizes = photos?.photos[0];
    if (!sizes?.length) throw new HttpError(404, "Rasm yo'q");
    const size = sizes.find((p) => p.width >= 160) ?? sizes[sizes.length - 1];
    await sendTelegramFile(res, rt.api, size.file_id, "image/jpeg");
  });

  r.patch("/me/settings", async (req, res) => {
    const body = parseBody(z.object({ language: z.enum(LANGS).optional(), newsEnabled: z.boolean().optional() }).strict(), req);
    const s = session(req);
    let user = s.user;
    if (body.language) user = await setLanguage(user.id, body.language);
    if (body.newsEnabled !== undefined) user = await setNewsEnabled(user.id, body.newsEnabled);
    res.json(await meResponse({ ...s, user, lang: body.language ?? s.lang }, rt.api));
  });

  r.get("/notifications", async (req, res) => {
    const { page, pageSize } = parseQuery(pagination, req);
    const { items, total } = await listNotifications(session(req).user.id, page, pageSize);
    res.json(paged(items.map(notificationDto), total, page, pageSize));
  });

  return r;
}
