// Toshkent vaqti — UTC+5, yozgi vaqt yo'q
export const TASHKENT_OFFSET_MIN = 5 * 60;

/** 1250000 -> "1 250 000" */
export function formatMoney(amount: number): string {
  return Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** 1250000 -> "1 250 000 so'm" */
export function formatSum(amount: number): string {
  return `${formatMoney(amount)} so'm`;
}

function toTashkent(date: Date): Date {
  return new Date(date.getTime() + TASHKENT_OFFSET_MIN * 60_000);
}

const pad = (n: number) => n.toString().padStart(2, "0");

/** "23.09 14:02" (Toshkent vaqti) */
export function formatShortDateTime(date: Date): string {
  const t = toTashkent(date);
  return `${pad(t.getUTCDate())}.${pad(t.getUTCMonth() + 1)} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** "23.09.2026 14:02" (Toshkent vaqti) */
export function formatDateTime(date: Date): string {
  const t = toTashkent(date);
  return `${pad(t.getUTCDate())}.${pad(t.getUTCMonth() + 1)}.${t.getUTCFullYear()} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** Toshkent vaqti bo'yicha kun ichidagi daqiqa (0..1439) */
export function tashkentMinuteOfDay(date: Date): number {
  const t = toTashkent(date);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

/** "09:00" -> 540 */
export function parseHm(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Ish vaqti ichidami (BR-14). start < end deb hisoblanadi, masalan 09:00–22:00 */
export function isWorkingTime(date: Date, start: string, end: string): boolean {
  const m = tashkentMinuteOfDay(date);
  const s = parseHm(start);
  const e = parseHm(end);
  return s <= e ? m >= s && m < e : m >= s || m < e;
}

/**
 * Kurs nomining Telegram'da ko'rinadigan qismi: ko'pi bilan `max` belgi (emoji bitta belgi sanaladi),
 * "..." qo'shilmaydi — tugma kengligi oldindan aniq bo'ladi. Bazadagi nom o'zgarmaydi.
 */
export function formatCourseName(name: string, max: number): string {
  const chars = Array.from(name.trim());
  return chars.length <= max ? chars.join("") : chars.slice(0, max).join("").trimEnd();
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** "8600123412341234" -> "8600 **** **** 1234" */
export function maskCard(number: string): string {
  const d = number.replace(/\D/g, "");
  if (d.length < 8) return d;
  return `${d.slice(0, 4)} **** **** ${d.slice(-4)}`;
}

/** "8600123412341234" -> "8600 1234 1234 1234" */
export function groupCard(number: string): string {
  return number
    .replace(/\D/g, "")
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

/** "+998901234567" -> "+998 90 123 45 67" */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const m = phone.match(/^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}

/** Toshkent vaqti bo'yicha kun boshi (UTC Date sifatida) */
export function startOfTashkentDay(date: Date = new Date()): Date {
  const shifted = new Date(date.getTime() + TASHKENT_OFFSET_MIN * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - TASHKENT_OFFSET_MIN * 60_000);
}

/**
 * Prisma `contains` (SQL LIKE) uchun: % va _ belgilari so'zma-so'z qidiriladi (aks holda "%" hammasini topadi).
 * PostgreSQL LIKE da standart ekranlash belgisi — "\\".
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** "23.09.2026" (Toshkent vaqti) */
export function formatDate(date: Date): string {
  const t = toTashkent(date);
  return `${pad(t.getUTCDate())}.${pad(t.getUTCMonth() + 1)}.${t.getUTCFullYear()}`;
}

/** HTML teglarini olib tashlab, oddiy matnga aylantiradi (qisqa ko'rinishlar uchun) */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Uzun matnni qisqartiradi: "Juda uzun ma…" */
export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
