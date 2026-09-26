import { createHmac, timingSafeEqual } from "node:crypto";

/** Telegram Mini App foydalanuvchisi (initData ichidagi `user`) */
export interface WebAppUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface VerifiedInitData {
  user: WebAppUser;
  authDate: Date;
  startParam: string | null;
}

export class InitDataError extends Error {}

/** data_check_string: hash dan tashqari barcha maydonlar, kalit bo'yicha saralangan, "\n" bilan */
function signature(params: URLSearchParams, botToken: string): Buffer {
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secret).update(dataCheckString).digest();
}

/**
 * Telegram Mini App `initData` ni tekshiradi (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 * secret = HMAC_SHA256("WebAppData", botToken), hash = HMAC_SHA256(secret, data_check_string).
 * Frontend yuborgan ma'lumotga ishonilmaydi — faqat imzo to'g'ri va yangi bo'lsa qabul qilinadi.
 */
export function verifyInitData(initData: string, botToken: string, maxAgeSec: number, now = Date.now()): VerifiedInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new InitDataError("hash yo'q yoki noto'g'ri");
  params.delete("hash");

  const expected = signature(params, botToken);
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) throw new InitDataError("imzo mos emas");

  const authDateSec = Number(params.get("auth_date"));
  if (!Number.isFinite(authDateSec) || authDateSec <= 0) throw new InitDataError("auth_date yo'q");
  if (now / 1000 - authDateSec > maxAgeSec) throw new InitDataError("initData eskirgan");

  const rawUser = params.get("user");
  if (!rawUser) throw new InitDataError("user yo'q");
  let user: unknown;
  try {
    user = JSON.parse(rawUser);
  } catch {
    throw new InitDataError("user JSON noto'g'ri");
  }
  if (!isWebAppUser(user)) throw new InitDataError("user maydonlari noto'g'ri");

  return { user, authDate: new Date(authDateSec * 1000), startParam: params.get("start_param") };
}

function isWebAppUser(x: unknown): x is WebAppUser {
  if (typeof x !== "object" || x === null) return false;
  const u = x as Record<string, unknown>;
  const optionalString = (k: string) => u[k] === undefined || typeof u[k] === "string";
  return (
    typeof u.id === "number" &&
    Number.isSafeInteger(u.id) &&
    u.id > 0 &&
    typeof u.first_name === "string" &&
    optionalString("last_name") &&
    optionalString("username") &&
    optionalString("language_code") &&
    optionalString("photo_url")
  );
}

/** Testlar va lokal tekshiruv uchun: berilgan token bilan to'g'ri imzolangan initData */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  params.set("hash", signature(params, botToken).toString("hex"));
  return params.toString();
}
