import { Router } from "express";
import rateLimit from "express-rate-limit";
import { notFound } from "../errors";
import type { BotRuntime } from "../runtime";
import { accountRouter, authRouter } from "./account";
import { adminRouter } from "./admin";
import { requireAppUser, session } from "./session";
import { shopRouter } from "./shop";

/**
 * Telegram Mini App API: /api/app/*
 * Kirish — Telegram initData orqali (panel JWT dan mustaqil). /auth/telegram dan boshqa hammasi Mini App tokeni talab qiladi.
 */
const limited = { error: "Juda ko'p so'rov. Birozdan keyin qayta urinib ko'ring.", details: { code: "rate_limited" } };

/**
 * Kirgan foydalanuvchi uchun limit Telegram ID bo'yicha (IP emas): mobil operatorlarda minglab
 * foydalanuvchi bitta IP dan chiqadi (CGNAT) — IP limiti ularni bir-biriga bog'lab qo'yardi.
 */
const userLimiter = rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `u:${session(req).user.id}`,
  message: limited,
});

/** Og'ir amallar (buyurtma, chek yuklash, video, link — Telegram API chaqiradi) */
const heavyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `h:${session(req).user.id}`,
  skip: (req) => req.method !== "POST" || req.path.startsWith("/admin/"),
  message: limited,
});

export function webAppRouter(rt: BotRuntime): Router {
  const r = Router();
  r.use(authRouter(rt));
  r.use(requireAppUser);
  r.use(userLimiter, heavyLimiter);
  r.use(accountRouter(rt));
  r.use(shopRouter(rt));
  r.use("/admin", adminRouter(rt));
  r.use(notFound);
  return r;
}
