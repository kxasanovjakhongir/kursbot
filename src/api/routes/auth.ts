import { Router, type Request, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../db";
import { hashPassword, toSafe, verifyCredentials } from "../../services/panelUsers";
import { logActivity } from "../../services/activity";
import { OTP_TTL_MINUTES, requestPasswordReset, revokeOtps, verifyPasswordResetOtp } from "../../services/adminOtp";
import { logger } from "../../lib/logger";
import { currentUser, requireAuth, signToken } from "../auth";
import { HttpError } from "../errors";
import { clientIp, parseBody } from "../validate";

export const authRouter = Router();

// Parol tanlashdan himoya: 15 daqiqada 10 urinish
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Juda ko'p urinish. 15 daqiqadan keyin qayta urinib ko'ring." },
});

// Bitta akkauntga ko'p IP dan parol terish: email bo'yicha, faqat muvaffaqiyatsiz urinishlar sanaladi
const accountLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const body: unknown = req.body;
    const email = typeof body === "object" && body !== null && "email" in body && typeof body.email === "string" ? body.email : "";
    return `login:${email.trim().toLowerCase().slice(0, 200)}`;
  },
  message: { error: "Bu akkauntga juda ko'p muvaffaqiyatsiz urinish. 15 daqiqadan keyin qayta urinib ko'ring." },
});

const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

authRouter.post("/login", loginLimiter, accountLimiter, async (req, res) => {
  const { email, password } = parseBody(loginSchema, req);
  const user = await verifyCredentials(email, password);
  if (!user) {
    await logActivity(null, "LOGIN_FAILED", `Muvaffaqiyatsiz kirish: ${email}`, clientIp(req));
    throw new HttpError(401, "Email yoki parol noto'g'ri");
  }
  const updated = await prisma.panelUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await logActivity(user.id, "LOGIN", "Tizimga kirdi", clientIp(req));
  res.json({ token: signToken(updated), user: toSafe(updated) });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: currentUser(req) });
});

authRouter.post("/logout", requireAuth, async (req, res) => {
  await logActivity(currentUser(req).id, "LOGOUT", "Tizimdan chiqdi", clientIp(req));
  res.json({ ok: true });
});

authRouter.put("/profile", requireAuth, async (req, res) => {
  const { name } = parseBody(z.object({ name: z.string().trim().min(2).max(100) }), req);
  const me = currentUser(req);
  const updated = await prisma.panelUser.update({ where: { id: me.id }, data: { name } });
  await logActivity(me.id, "UPDATE_PROFILE", `Ism o'zgartirildi: ${name}`, clientIp(req));
  res.json({ user: toSafe(updated) });
});

// ---------- Parolni almashtirish ----------
// Harf va raqam bo'lishi shart; uzunlik bcrypt chegarasidan oshmaydi
const newPasswordSchema = z
  .string()
  .min(8, "Parol kamida 8 belgidan iborat bo'lishi kerak")
  .max(200)
  .refine((p) => /\p{L}/u.test(p) && /\d/.test(p), "Parolda kamida bitta harf va bitta raqam bo'lishi kerak");

/**
 * Oddiy holatda joriy parol tekshiriladi. "Parolni unutdim" (OTP) orqali kirilgan bo'lsa —
 * faqat yangi parol. Saqlangach boshqa barcha sessiyalar bekor bo'ladi (token parol barmoq izini
 * saqlaydi), shu qurilma esa yangi token bilan davom etadi.
 */
const changePassword: RequestHandler = async (req, res) => {
  const body = parseBody(z.object({ currentPassword: z.string().max(200).optional(), newPassword: newPasswordSchema }), req);
  const me = currentUser(req);
  const full = await prisma.panelUser.findUniqueOrThrow({ where: { id: me.id } });
  if (!full.mustChangePassword) {
    if (!body.currentPassword) throw new HttpError(400, "Joriy parolni kiriting");
    if (!(await bcrypt.compare(body.currentPassword, full.passwordHash))) throw new HttpError(400, "Joriy parol noto'g'ri");
  }
  const updated = await prisma.panelUser.update({
    where: { id: me.id },
    data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false },
  });
  await revokeOtps(me.id);
  await logActivity(me.id, "CHANGE_PASSWORD", full.mustChangePassword ? "Parol o'zgartirildi (kod orqali kirgandan keyin)" : "Parol o'zgartirildi", clientIp(req));
  res.json({ ok: true, token: signToken(updated), user: toSafe(updated) });
};
authRouter.put("/password", requireAuth, changePassword);
authRouter.patch("/password", requireAuth, changePassword);

// ---------- Parolni unutdim: email orqali bir martalik kod ----------
const FORGOT_MESSAGE = "Agar email ro'yxatdan o'tgan bo'lsa, kod yuborildi";
const emailKey = (prefix: string) => (req: Request) => {
  const body: unknown = req.body;
  const email = typeof body === "object" && body !== null && "email" in body && typeof body.email === "string" ? body.email : "";
  return `${prefix}:${email.trim().toLowerCase().slice(0, 200)}`;
};
const limiter = (windowMs: number, limit: number, error: string, keyGenerator?: (req: Request) => string) =>
  rateLimit({ windowMs, limit, standardHeaders: "draft-7", legacyHeaders: false, keyGenerator, message: { error, code: "rate_limited", details: { code: "rate_limited" } } });

// Limitlar email bor-yo'qligidan qat'i nazar bir xil ishlaydi — javob orqali hech narsa oshkor bo'lmaydi
const forgotIpLimiter = limiter(15 * 60_000, 10, "Juda ko'p so'rov. 15 daqiqadan keyin qayta urinib ko'ring.");
const forgotEmailMinuteLimiter = limiter(60_000, 1, "Kodni qayta so'rash uchun 60 soniya kuting.", emailKey("forgot-1m"));
const forgotEmailHourLimiter = limiter(60 * 60_000, 5, "Bu email uchun soatiga 5 tadan ko'p kod so'rab bo'lmaydi. Keyinroq urinib ko'ring.", emailKey("forgot-1h"));
const verifyIpLimiter = limiter(15 * 60_000, 30, "Juda ko'p urinish. 15 daqiqadan keyin qayta urinib ko'ring.");

const emailSchema = z.string().trim().email("Email noto'g'ri").max(200);

authRouter.post("/forgot-password", forgotIpLimiter, forgotEmailHourLimiter, forgotEmailMinuteLimiter, async (req, res) => {
  const { email } = parseBody(z.object({ email: emailSchema }), req);
  // Javob darhol va har doim bir xil: kod yaratish va xat yuborish fonda — javob vaqtidan ham
  // email ro'yxatda bor-yo'qligini bilib bo'lmaydi
  void requestPasswordReset(email, clientIp(req)).catch((err: unknown) => logger.error({ err }, "parol tiklash kodi yaratilmadi"));
  res.json({ ok: true, message: FORGOT_MESSAGE, resendAfterSeconds: 60, ttlMinutes: OTP_TTL_MINUTES });
});

authRouter.post("/verify-otp", verifyIpLimiter, async (req, res) => {
  const { email, code } = parseBody(z.object({ email: emailSchema, code: z.string().trim().regex(/^\d{6}$/, "Kod 6 ta raqamdan iborat") }), req);
  const result = await verifyPasswordResetOtp(email, code, clientIp(req));
  if (!result.ok) {
    throw new HttpError(
      400,
      result.remainingAttempts > 0
        ? `Kod noto'g'ri. Qolgan urinishlar: ${result.remainingAttempts}`
        : "Kod noto'g'ri, muddati o'tgan yoki bloklangan. Yangi kod so'rang",
      { code: "OTP_INVALID", remainingAttempts: result.remainingAttempts },
    );
  }
  res.json({ token: signToken(result.admin), user: toSafe(result.admin), mustChangePassword: true });
});
