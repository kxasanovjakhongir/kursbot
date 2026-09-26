import { createHash } from "node:crypto";
import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { config } from "../config";
import { prisma } from "../db";
import { logger } from "../lib/logger";
import { botUsername } from "../services/botInfo";
import { LINK_CODE_RE } from "../services/campaignLinks";
import type { BotRuntime } from "./runtime";

/**
 * Unique bosishlar uchun tashrifchi belgisi. IP va brauzer saqlanmaydi: kunlik tuzli hash
 * (bir kunda bir odamni bir marta sanash mumkin, lekin uni tiklab/kuzatib bo'lmaydi).
 */
function visitorHash(ip: string, userAgent: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${config.JWT_SECRET}|click|${day}|${ip}|${userAgent}`).digest("hex").slice(0, 32);
}

/**
 * GET /l/<kod> — reklama uchun tracking link: bosish yoziladi va t.me/<bot>?start=<kod> ga yo'naltiriladi.
 * Faqat botning o'z manziliga yo'naltiradi (open redirect yo'q); kod noto'g'ri bo'lsa — oddiy bot linki.
 */
export function mountTrackingRedirect(app: Express, rt: BotRuntime): void {
  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false });

  app.get("/l/:code", limiter, async (req, res) => {
    const username = await botUsername(rt.api);
    if (!username) return void res.status(503).send("Bot vaqtincha mavjud emas");
    const raw = String(req.params.code).toLowerCase();
    const link = LINK_CODE_RE.test(raw) ? await prisma.campaignLink.findUnique({ where: { code: raw }, select: { id: true, code: true, isActive: true } }) : null;

    if (link?.isActive) {
      // Bosishni yozish yo'naltirishni kechiktirmaydi (xato bo'lsa ham foydalanuvchi botga o'tadi)
      void prisma.linkClick
        .create({ data: { linkId: link.id, visitorHash: visitorHash(req.ip ?? "", req.get("user-agent") ?? "") } })
        .catch((err: unknown) => logger.warn({ err }, "link bosishi yozilmadi"));
    }
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, link?.isActive ? `https://t.me/${username}?start=${link.code}` : `https://t.me/${username}`);
  });
}
