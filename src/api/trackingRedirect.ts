import { createHash, randomBytes } from "node:crypto";
import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { config } from "../config";
import { prisma } from "../db";
import { logger } from "../lib/logger";
import { linkOpens } from "../lib/metrics";
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

/** Havola oldindan ko'ruvchi robotlar (Meta, Telegram, WhatsApp...) — ularga sahifa emas, oddiy yo'naltirish */
const ROBOT_RE = /facebookexternalhit|facebot|\bbot\b|bot\/|crawler|spider|TelegramBot|WhatsApp|Slackbot|Twitterbot|curl|wget/i;
const ANDROID_RE = /Android/i;
const IOS_RE = /iPhone|iPad|iPod/i;
/** Telefon (har qanday brauzer: Chrome, Samsung, Safari, Instagram/Facebook ichki oynasi, nomsiz WebView) */
const MOBILE_RE = /Android|iPhone|iPad|iPod|Mobile|FBAN|FBAV|Instagram/i;

/**
 * Telegramni ochish usullari. Raqam start kodining oxiriga qo'shiladi ("<kod>-m<N>") va bot uni "start" hodisasiga
 * yozadi — qaysi usulda odam haqiqatan botga yetib kelgani bazada ko'rinadi:
 *   m1 — tg://resolve (Telegram ilovasi to'g'ridan-to'g'ri)
 *   m2 — https://t.me (Telegram'ning o'z sahifasi / universal link)
 *   m3 — intent:// (faqat Android; Telegram yo'q bo'lsa t.me ga qaytadi)
 *   m9 — avtomatik ochilmay, odam pastdagi havolani o'zi bosgan
 */
export const OPEN_METHODS = { ios: [1, 2], android: [3, 1, 2], other: [1, 2] } as const;
export type Platform = keyof typeof OPEN_METHODS;

/** Telefondan kelgan odam (robot emas) — unga Telegramni kod bilan ochadigan sahifa beriladi */
export function servesOpenPage(ua: string): boolean {
  return MOBILE_RE.test(ua) && !ROBOT_RE.test(ua);
}

export function detectPlatform(ua: string): Platform {
  return ANDROID_RE.test(ua) ? "android" : IOS_RE.test(ua) ? "ios" : "other";
}

export function pickMethod(platform: Platform, random: () => number = Math.random): number {
  const list = OPEN_METHODS[platform];
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

function openUrl(method: number, username: string, start: string): string {
  const web = `https://t.me/${username}?start=${start}`;
  const q = `domain=${username}&start=${start}`;
  if (method === 1) return `tg://resolve?${q}`;
  if (method === 3) return `intent://resolve?${q}#Intent;scheme=tg;package=org.telegram.messenger;S.browser_fallback_url=${encodeURIComponent(web)};end`;
  return web;
}

/**
 * Telefon uchun oraliq sahifa: tugmasiz, Telegramni darhol avtomatik ochadi. Faqat 2,5 soniyada ochilmasa
 * (sahifa hali ko'rinib tursa) — kichik zaxira havola chiqadi, odam qotib qolmasin.
 */
function openPage(username: string, code: string, method: number, nonce: string): string {
  const auto = openUrl(method, username, `${code}-m${method}`);
  const manual = openUrl(2, username, `${code}-m9`);
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Telegram ochilmoqda</title><style>
body{margin:0;font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;background:#f3f5f9;color:#111;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:340px;padding:24px 20px;text-align:center}p{color:#555;font-size:16px;line-height:1.45;margin:0}
#alt{display:none;margin-top:18px;font-size:15px}#alt a{color:#2aabee;font-weight:600}
</style></head><body><main><p>Telegram ochilmoqda…</p><p id="alt">Ochilmadimi? <a href="${manual}">Telegramda ochish</a></p></main>
<script nonce="${nonce}">(function(){location.href=${JSON.stringify(auto)};
setTimeout(function(){if(!document.hidden)document.getElementById("alt").style.display="block"},2500);})();</script></body></html>`;
}

/**
 * GET /l/<kod> — reklama uchun tracking link: bosish yoziladi; telefonda Telegram kod bilan ochiladi (openPage),
 * kompyuter va robotlar — t.me/<bot>?start=<kod> ga 302.
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
    // Telefondan kelgan har qanday brauzer (nomidan qat'i nazar) — Telegramni kod bilan ochadigan sahifa;
    // robotlar va kompyuter — oddiy yo'naltirish
    const ua = req.get("user-agent") ?? "";
    if (link?.isActive && servesOpenPage(ua)) {
      const platform = detectPlatform(ua);
      const method = pickMethod(platform);
      linkOpens.inc({ platform, method: `m${method}` });
      const nonce = randomBytes(16).toString("base64");
      res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'`);
      return void res.type("html").send(openPage(username, link.code, method, nonce));
    }
    res.redirect(302, link?.isActive ? `https://t.me/${username}?start=${link.code}` : `https://t.me/${username}`);
  });
}
