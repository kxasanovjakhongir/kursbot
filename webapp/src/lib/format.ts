import type { Lang } from "./types";

// uz-UZ brauzerlarda ISO ko'rinishida (2026-09-23) chiqadi — O'zbekistonda odatiy 23.09.2026 formati ru-RU da
const LOCALE: Record<Lang, string> = { uz: "ru-RU", ru: "ru-RU", en: "en-GB" };
const TZ = "Asia/Tashkent";

/** 1250000 -> "1 250 000" */
export const fmtNumber = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export const fmtDate = (iso: string, lang: Lang) =>
  new Intl.DateTimeFormat(LOCALE[lang], { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));

export const fmtDateTime = (iso: string, lang: Lang) =>
  new Intl.DateTimeFormat(LOCALE[lang], { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** "8600123412341234" -> "8600 1234 1234 1234" */
export const groupCard = (n: string) => n.replace(/(.{4})/g, "$1 ").trim();

export function fullName(u: { firstName: string | null; lastName?: string | null }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || "—";
}

/** "+998901234567" -> "+998 90 123 45 67" */
export function formatPhone(phone: string): string {
  const m = phone.match(/^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}
