import type { RequestHandler } from "express";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import type { PanelUser } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db";
import { toSafe } from "../services/panelUsers";
import { can, type Permission } from "../services/permissions";
import { HttpError } from "./errors";

interface TokenPayload {
  sub: string;
  /** Parol "barmoq izi": parol o'zgarsa eski tokenlar darhol yaroqsiz bo'ladi */
  pv: string;
}

/** Parol xeshidan qisqa barmoq izi (xeshning o'zi tokenga tushmaydi) */
const passwordVersion = (passwordHash: string) => createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);

export function signToken(user: PanelUser): string {
  return jwt.sign({ sub: String(user.id), pv: passwordVersion(user.passwordHash) } satisfies TokenPayload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    algorithm: "HS256",
  });
}

function readPayload(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
    return typeof decoded === "object" && typeof decoded.sub === "string" && typeof decoded.pv === "string" ? { sub: decoded.sub, pv: decoded.pv } : null;
  } catch {
    return null;
  }
}

/**
 * "Parolni unutdim" (OTP) orqali kirgan admin yangi parol o'rnatmaguncha faqat shularga kira oladi.
 * Qolgan HAMMA marshrutlar (kelajakda qo'shiladiganlari ham) yopiq.
 */
const PASSWORD_CHANGE_ALLOWED = new Set(["GET /api/auth/me", "POST /api/auth/logout", "PUT /api/auth/password", "PATCH /api/auth/password"]);
export const PASSWORD_CHANGE_REQUIRED = "PASSWORD_CHANGE_REQUIRED";

/**
 * JWT tekshiruvi. Foydalanuvchi har so'rovda bazadan qayta o'qiladi —
 * o'chirilgan yoki roli o'zgargan admin darhol huquqini yo'qotadi.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token ? readPayload(token) : null;
  if (!payload) throw new HttpError(401, "Avtorizatsiya talab qilinadi");

  const user = await prisma.panelUser.findUnique({ where: { id: Number(payload.sub) } });
  if (!user || !user.isActive || payload.pv !== passwordVersion(user.passwordHash)) throw new HttpError(401, "Sessiya yaroqsiz");
  req.panelUser = toSafe(user);
  if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(`${req.method} ${req.originalUrl.split("?")[0].replace(/\/+$/, "")}`)) {
    throw new HttpError(403, "Xavfsizlik uchun avval yangi parol o'rnating", { code: PASSWORD_CHANGE_REQUIRED });
  }
  next();
};

/** Ruxsat tekshiruvi — rollar jadvali services/permissions.ts da (bot bilan umumiy) */
export function assertPermission(req: Parameters<RequestHandler>[0], permission: Permission): void {
  if (!req.panelUser) throw new HttpError(401, "Avtorizatsiya talab qilinadi");
  if (!can(req.panelUser.role, permission)) throw new HttpError(403, "Bu amal uchun ruxsatingiz yo'q");
}

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    assertPermission(req, permission);
    next();
  };
}

/** Faqat SUPER_ADMIN (tizim sozlamalari) */
export const requireSuperAdmin: RequestHandler = requirePermission("settings.manage");

export function currentUser(req: Parameters<RequestHandler>[0]) {
  if (!req.panelUser) throw new HttpError(401, "Avtorizatsiya talab qilinadi");
  return req.panelUser;
}
