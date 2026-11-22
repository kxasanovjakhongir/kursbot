import { createHash, randomBytes } from "node:crypto";
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

/** Facebook / Instagram / Messenger ichki brauzeri (reklama shu yerda ochiladi) */
const IN_APP_RE = /FBAN|FBAV|FB_IAB|FBIOS|FB4A|Instagram|Messenger/i;

/**
 * Ichki brauzer t.me ga oddiy 302 bilan o'tganda Telegramni ko'pincha ochmaydi yoki start parametrisiz ochadi
 * (bot faqat "Start" bilan ochiladi, darslik yuborilmaydi). Shuning uchun Telegram ilovasi to'g'ridan-to'g'ri
 * chaqiriladi: Android — intent:// (Telegram o'rnatilmagan bo'lsa t.me ga qaytadi), iOS — tg://; tugmalar — zaxira.
 */
function inAppPage(username: string, start: string, nonce: string): string {
  const q = `domain=${username}&start=${start}`;
  const web = `https://t.me/${username}?start=${start}`;
  const intent = `intent://resolve?${q}#Intent;scheme=tg;package=org.telegram.messenger;S.browser_fallback_url=${encodeURIComponent(web)};end`;
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Telegramda ochish</title><style>
body{margin:0;font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;background:#f3f5f9;color:#111;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:360px;padding:24px 20px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#555;font-size:15px;line-height:1.45;margin:0 0 20px}
a{display:block;padding:15px;border-radius:12px;font-weight:600;font-size:16px;text-decoration:none;margin-bottom:12px}
.tg{background:#2aabee;color:#fff}.alt{background:#fff;color:#2aabee;border:1px solid #cfe3f3}
</style></head><body><main><h1>Darslik Telegram botda</h1><p>Darslik avtomatik ochilmasa, pastdagi tugmani bosing.</p>
<a class="tg" id="open" href="tg://resolve?${q}">Telegramda ochish</a><a class="alt" href="${web}">Ochilmasa — shu yerni bosing</a></main>
<script nonce="${nonce}">(function(){var a=/android/i.test(navigator.userAgent);var u=a?${JSON.stringify(intent)}:"tg://resolve?${q}";
if(a)document.getElementById("open").href=u;setTimeout(function(){location.href=u},50);})();</script></body></html>`;
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
    if (link?.isActive && IN_APP_RE.test(req.get("user-agent") ?? "")) {
      const nonce = randomBytes(16).toString("base64");
      res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'`);
      return void res.type("html").send(inAppPage(username, link.code, nonce));
    }
    res.redirect(302, link?.isActive ? `https://t.me/${username}?start=${link.code}` : `https://t.me/${username}`);
  });
}
