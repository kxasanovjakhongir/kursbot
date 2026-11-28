import { createHash } from "node:crypto";
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

/** Havola oldindan ko'ruvchi robotlar (Meta, Telegram, WhatsApp...) — bosish belgisi qo'shilmaydi */
const ROBOT_RE = /facebookexternalhit|facebot|\bbot\b|bot\/|crawler|spider|TelegramBot|WhatsApp|Slackbot|Twitterbot|curl|wget/i;
const ANDROID_RE = /Android/i;
const IOS_RE = /iPhone|iPad|iPod/i;
/** Telefon (har qanday brauzer: Chrome, Samsung, Safari, Instagram/Facebook ichki oynasi, nomsiz WebView) */
const MOBILE_RE = /Android|iPhone|iPad|iPod|Mobile|FBAN|FBAV|Instagram/i;

/**
 * Telefondan bosilganda start kodiga usul belgisi qo'shiladi ("<kod>-m4") — bot uni "start" hodisasiga yozadi va
 * statistikada tracking link orqali qancha odam botga yetib kelgani ko'rinadi. Kod o'zgarmaydi (bot belgini olib tashlaydi).
 *
 * Tarix: 2026-11-22…28 telefonga oraliq JS sahifa berilgan (tg:// / intent:// / t.me ni skript bilan ochish, m1–m3, m9).
 * Instagram/Facebook ichki brauzeri va Chrome skript bilan (bosishsiz) boshlangan o'tishda Telegram ilovasini ochmaydi,
 * intent:// ni esa Instagram umuman qo'llamaydi: 145 ta haqiqiy bosishdan atigi 10 tasi botga yetib keldi (Android
 * Instagram — 109 dan 2). Oddiy 302 esa odamning bosishi bilan bitta o'tish hisoblanadi — to'g'ridan-to'g'ri t.me
 * havolasi kabi Telegram start kodi bilan ochiladi.
 */
export const REDIRECT_METHOD = 4;

/** Telefondan kelgan odam (robot emas) — bosish belgisi bilan yo'naltiriladi */
export function isPhoneVisitor(ua: string): boolean {
  return MOBILE_RE.test(ua) && !ROBOT_RE.test(ua);
}

export function detectPlatform(ua: string): "android" | "ios" | "other" {
  return ANDROID_RE.test(ua) ? "android" : IOS_RE.test(ua) ? "ios" : "other";
}

/** Brauzerning oldindan yuklash (prefetch/preview) so'rovi — odam hali bosmagan, bosish deb sanalmaydi */
export function isPrefetch(headers: Record<string, string | string[] | undefined>): boolean {
  const v = ["sec-purpose", "purpose", "x-purpose", "x-moz"].map((h) => String(headers[h] ?? "")).join(" ");
  return /prefetch|preview|prerender/i.test(v);
}

/**
 * GET /l/<kod> — reklama uchun tracking link: bosish yoziladi va t.me/<bot>?start=<kod> ga 302
 * (telefondan bo'lsa kod oxirida "-m4" — botga yetib kelganlarni o'lchash uchun).
 * Faqat botning o'z manziliga yo'naltiradi (open redirect yo'q); kod noto'g'ri bo'lsa — oddiy bot linki.
 */
export function mountTrackingRedirect(app: Express, rt: BotRuntime): void {
  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false });

  app.get("/l/:code", limiter, async (req, res) => {
    const username = await botUsername(rt.api);
    if (!username) return void res.status(503).send("Bot vaqtincha mavjud emas");
    const raw = String(req.params.code).toLowerCase();
    const link = LINK_CODE_RE.test(raw) ? await prisma.campaignLink.findUnique({ where: { code: raw }, select: { id: true, code: true, isActive: true } }) : null;

    if (link?.isActive && !isPrefetch(req.headers)) {
      // Bosishni yozish yo'naltirishni kechiktirmaydi (xato bo'lsa ham foydalanuvchi botga o'tadi)
      void prisma.linkClick
        .create({ data: { linkId: link.id, visitorHash: visitorHash(req.ip ?? "", req.get("user-agent") ?? "") } })
        .catch((err: unknown) => logger.warn({ err }, "link bosishi yozilmadi"));
    }
    res.setHeader("Cache-Control", "no-store");
    if (!link?.isActive) return void res.redirect(302, `https://t.me/${username}`);
    // Hamma uchun oddiy 302: Meta roboti ham, odam ham aynan t.me linkini ko'radi
    const ua = req.get("user-agent") ?? "";
    let start = link.code;
    if (isPhoneVisitor(ua)) {
      linkOpens.inc({ platform: detectPlatform(ua), method: `m${REDIRECT_METHOD}` });
      start = `${link.code}-m${REDIRECT_METHOD}`;
    }
    res.redirect(302, `https://t.me/${username}?start=${start}`);
  });
}
