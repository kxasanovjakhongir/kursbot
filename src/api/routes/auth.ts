import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../db";
import { hashPassword, toSafe, verifyCredentials } from "../../services/panelUsers";
import { logActivity } from "../../services/activity";
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

const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

authRouter.post("/login", loginLimiter, async (req, res) => {
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

authRouter.put("/password", requireAuth, async (req, res) => {
  const body = parseBody(
    z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) }),
    req,
  );
  const me = currentUser(req);
  const full = await prisma.panelUser.findUniqueOrThrow({ where: { id: me.id } });
  if (!(await bcrypt.compare(body.currentPassword, full.passwordHash))) {
    throw new HttpError(400, "Joriy parol noto'g'ri");
  }
  await prisma.panelUser.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(body.newPassword) } });
  await logActivity(me.id, "CHANGE_PASSWORD", "Parol o'zgartirildi", clientIp(req));
  res.json({ ok: true });
});
