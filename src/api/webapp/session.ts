import { createHash } from "node:crypto";
import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import type { Admin, User } from "@prisma/client";
import { config } from "../../config";
import { prisma } from "../../db";
import type { Lang } from "../../i18n";
import { getAdmin } from "../../services/admins";
import { can, roleOf, type Permission, type Role } from "../../services/permissions";
import { getSettings } from "../../services/settings";
import { userLang } from "../../services/users";
import { HttpError } from "../errors";

/** Mini App so'rovidagi foydalanuvchi (requireAppUser dan keyin) */
export interface AppSession {
  user: User;
  admin: Admin | null;
  role: Role;
  lang: Lang;
}

const TOKEN_TTL = "12h";
const TOKEN_TYPE = "webapp";

/**
 * Mini App tokenlari panel tokenlaridan ALOHIDA kalit bilan imzolanadi:
 * Mini App tokeni admin panelga kirish uchun ishlatila olmaydi va aksincha.
 */
const secret = createHash("sha256").update(`webapp-session:${config.JWT_SECRET}`).digest();

interface AppTokenPayload {
  sub: string;
  typ: typeof TOKEN_TYPE;
}

export function signAppToken(user: User): string {
  return jwt.sign({ sub: user.id.toString(), typ: TOKEN_TYPE } satisfies AppTokenPayload, secret, { expiresIn: TOKEN_TTL, algorithm: "HS256" });
}

function readUserId(token: string): bigint | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof decoded !== "object" || decoded.typ !== TOKEN_TYPE || typeof decoded.sub !== "string" || !/^\d{1,18}$/.test(decoded.sub)) return null;
    return BigInt(decoded.sub);
  } catch {
    return null;
  }
}

/** Foydalanuvchi holati bo'yicha ruxsat: cheklangan — 403, texnik xizmat — 503 (adminlardan tashqari) */
export async function buildSession(user: User): Promise<AppSession> {
  const admin = await getAdmin(user.telegramId);
  const role = roleOf(admin);
  if (user.isBanned && !admin) throw new HttpError(403, "Botdan foydalanishingiz cheklangan", { code: "banned" });
  if (!admin && (await getSettings()).maintenance_mode) throw new HttpError(503, "Texnik xizmat", { code: "maintenance" });
  return { user, admin, role, lang: await userLang(user) };
}

/** Bearer token → foydalanuvchi har so'rovda bazadan qayta o'qiladi (cheklov va rol darhol kuchga kiradi) */
export const requireAppUser: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  const userId = header?.startsWith("Bearer ") ? readUserId(header.slice(7)) : null;
  if (!userId) throw new HttpError(401, "Avtorizatsiya talab qilinadi", { code: "unauthorized" });
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(401, "Sessiya yaroqsiz", { code: "unauthorized" });
  req.appSession = await buildSession(user);
  next();
};

export function session(req: Request): AppSession {
  if (!req.appSession) throw new HttpError(401, "Avtorizatsiya talab qilinadi", { code: "unauthorized" });
  return req.appSession;
}

export function assertAppPermission(req: Request, permission: Permission): AppSession {
  const s = session(req);
  if (!can(s.role, permission)) throw new HttpError(403, "Bu amal uchun ruxsatingiz yo'q", { code: "forbidden" });
  return s;
}
