import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import type { PanelUser } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db";
import { toSafe } from "../services/panelUsers";
import { HttpError } from "./errors";

interface TokenPayload {
  sub: string;
}

export function signToken(user: PanelUser): string {
  return jwt.sign({ sub: String(user.id) } satisfies TokenPayload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    algorithm: "HS256",
  });
}

function readPayload(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
    return typeof decoded === "object" && typeof decoded.sub === "string" ? { sub: decoded.sub } : null;
  } catch {
    return null;
  }
}

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
  if (!user || !user.isActive) throw new HttpError(401, "Sessiya yaroqsiz");
  req.panelUser = toSafe(user);
  next();
};

/** Faqat SUPER_ADMIN */
export const requireSuperAdmin: RequestHandler = (req, _res, next) => {
  if (req.panelUser?.role !== "superadmin") throw new HttpError(403, "Bu amal faqat Super Admin uchun");
  next();
};

export function currentUser(req: Parameters<RequestHandler>[0]) {
  if (!req.panelUser) throw new HttpError(401, "Avtorizatsiya talab qilinadi");
  return req.panelUser;
}
