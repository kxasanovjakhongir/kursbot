import { createHmac, timingSafeEqual } from "node:crypto";
import { clickEnabled, config, paymeEnabled } from "../../config";
import { parseOrderId } from "./common";

/**
 * Qisqa to'lov havolasi: https://<domen>/pay/<tizim>/<buyurtma>-<imzo>; server uni to'lov sahifasiga yo'naltiradi
 * (api/payRedirect.ts). Bot tugmalari endi to'g'ridan-to'g'ri to'lov tizimiga olib boradi (ilova ochilishi uchun) —
 * bu manzil ilgari yuborilgan xabarlardagi tugmalar ishlashda davom etishi uchun saqlanadi.
 */

export type PayProvider = "payme" | "click";

export const payProviderEnabled = (provider: PayProvider): boolean => (provider === "payme" ? paymeEnabled() : clickEnabled());

/** Imzo: buyurtma raqamlarini ketma-ket terib, begona buyurtma summasini ko'rib bo'lmaydi */
function sign(provider: PayProvider, orderId: bigint): string {
  return createHmac("sha256", config.JWT_SECRET).update(`pay|${provider}|${orderId}`).digest("base64url").slice(0, 16);
}

/** Serverning ochiq manzili: PUBLIC_URL, bo'lmasa webhook domeni. Yo'q (lokal polling) — null */
function publicBase(): string | null {
  if (config.PUBLIC_URL) return config.PUBLIC_URL.replace(/\/$/, "");
  return config.WEBHOOK_URL ? new URL(config.WEBHOOK_URL).origin : null;
}

/** null — ochiq manzil sozlanmagan: chaqiruvchi to'lov tizimining to'g'ridan-to'g'ri havolasini ishlatadi */
export function shortPayUrl(provider: PayProvider, orderId: bigint): string | null {
  const base = publicBase();
  return base ? `${base}/pay/${provider}/${orderId}-${sign(provider, orderId)}` : null;
}

/** "<buyurtma>-<imzo>" → buyurtma raqami; imzo mos kelmasa null */
export function parsePayRef(provider: PayProvider, ref: string): bigint | null {
  const cut = ref.indexOf("-");
  const orderId = cut > 0 ? parseOrderId(ref.slice(0, cut)) : null;
  if (orderId === null) return null;
  const got = Buffer.from(ref.slice(cut + 1));
  const want = Buffer.from(sign(provider, orderId));
  return got.length === want.length && timingSafeEqual(got, want) ? orderId : null;
}
