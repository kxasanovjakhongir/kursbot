import type { User } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db";
import { logger } from "../lib/logger";

/**
 * CRM integratsiyasi: foydalanuvchi telefon raqamini ulashganda lid CRM webhook'iga yuboriladi.
 * CRM_WEBHOOK_URL bo'sh bo'lsa hech narsa qilmaydi.
 *
 * Bot oqimini to'xtatmaydi: chaqiruvchi `void sendLeadToCrm(...)` qiladi, xatolar faqat logga yoziladi.
 * 5xx va tarmoq xatolarida 3 martagacha qayta uriniladi; 4xx — so'rovning o'zi noto'g'ri, qayta urinilmaydi.
 */

export interface CrmLeadPayload {
  first_name: string;
  last_name: string;
  phone: string;
  telegram_id: string;
  telegram_username: string;
  /** Mijoz kelgan / tanlagan yo'nalish (kurs). Noma'lum bo'lsa maydon yuborilmaydi */
  yonalish?: string;
}

/**
 * CRM'dagi yo'nalish nomi: kurs nomidan. "1. Kompaniyani 4 bosqichda boshqarish" → "4 bosqichli boshqaruv",
 * "2. Kompaniyani ichki qonun qoidalari" → "Qonun qoidalar"; boshqa kurs — raqamsiz o'z nomi.
 */
export function crmCourseName(title: string): string {
  const name = title.replace(/^\s*\d+\s*[.)]\s*/, "").trim();
  if (/qonun/i.test(name)) return "Qonun qoidalar";
  const stages = /(\d+)\s*bosqich/i.exec(name);
  if (stages) return `${stages[1]} bosqichli boshqaruv`;
  return name;
}

export function buildLeadPayload(
  user: Pick<User, "telegramId" | "firstName" | "lastName" | "username" | "phone">,
  yonalish?: string | null,
): CrmLeadPayload | null {
  if (!user.phone) return null;
  return {
    first_name: user.firstName ?? "",
    last_name: user.lastName ?? "",
    phone: user.phone.startsWith("+") ? user.phone : `+${user.phone}`,
    telegram_id: user.telegramId.toString(),
    telegram_username: user.username ?? "",
    ...(yonalish ? { yonalish } : {}),
  };
}

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 10_000;

export interface SendOptions {
  url?: string;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * JSON ni CRM manziliga POST qiladi: 5xx va tarmoq xatosida 3 martagacha qayta uriniladi, 4xx da — yo'q.
 * true — CRM qabul qildi. `what` — logdagi nom ("lid", "to'lov").
 */
export async function postToCrm(
  url: string,
  payload: object,
  what: string,
  logFields: Record<string, string>,
  opts: Pick<SendOptions, "retryDelayMs" | "fetchImpl"> = {},
): Promise<boolean> {
  return (await postToCrmStatus(url, payload, what, logFields, opts)).ok;
}

/** postToCrm bilan bir xil, lekin CRM javobining holat kodini ham qaytaradi (null — javob olinmadi) */
export async function postToCrmStatus(
  url: string,
  payload: object,
  what: string,
  logFields: Record<string, string>,
  opts: Pick<SendOptions, "retryDelayMs" | "fetchImpl"> = {},
): Promise<{ ok: boolean; status: number | null }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const retryDelayMs = opts.retryDelayMs ?? 2000;
  const body = JSON.stringify(payload);
  // URL ichida maxfiy kalit bor — logga faqat logFields yoziladi
  const log = logger.child({ crm: true, ...logFields });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        // To'lov javobida "movedToWon": true — CRM lidni 100% ga o'tkazdi; false — lid topilmadi (telefon/Telegram ID mos emas)
        const moved = (await res.json().catch(() => null) as { movedToWon?: unknown } | null)?.movedToWon;
        if (moved === false) log.warn({ status: res.status, movedToWon: false }, `CRM: ${what} qabul qilindi, lekin lid 100% ga o'tmadi`);
        else log.info({ status: res.status, ...(typeof moved === "boolean" ? { movedToWon: moved } : {}) }, `CRM: ${what} yuborildi`);
        return { ok: true, status: res.status };
      }
      const text = (await res.text().catch(() => "")).slice(0, 300);
      if (res.status < 500) {
        log.error({ status: res.status, response: text }, `CRM: ${what} rad etildi`);
        return { ok: false, status: res.status };
      }
      log.warn({ status: res.status, attempt, response: text }, "CRM: server xatosi");
    } catch (err) {
      log.warn({ err: (err as Error).message, attempt }, "CRM: so'rov yiqildi");
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
  }
  log.error({ attempts: MAX_ATTEMPTS }, `CRM: ${what} yuborilmadi`);
  return { ok: false, status: null };
}

/**
 * CRM'ga oxirgi yuborilgan yo'nalish (Telegram ID → yo'nalish): bir xil yo'nalish qayta-qayta yuborilmaydi.
 * Jarayon xotirasida; qayta ishga tushgandan keyin ko'pi bilan bir marta takrorlanadi (CRM uchun zararsiz).
 */
const sentCourse = new Map<string, string>();
const SENT_COURSE_MAX = 20_000;

function rememberCourse(telegramId: string, yonalish: string | null | undefined): void {
  if (!yonalish) return;
  sentCourse.delete(telegramId);
  sentCourse.set(telegramId, yonalish);
  if (sentCourse.size > SENT_COURSE_MAX) sentCourse.delete(sentCourse.keys().next().value as string);
}

/** Testlar uchun */
export function resetCrmCourseCache(): void {
  sentCourse.clear();
}

/** Foydalanuvchining oxirgi kursi (lastProduct) bo'yicha yo'nalish */
async function courseOfUser(user: { lastProduct?: string | null }): Promise<string | null> {
  if (!user.lastProduct) return null;
  const product = await prisma.product.findUnique({ where: { code: user.lastProduct }, select: { title: true } }).catch(() => null);
  return product ? crmCourseName(product.title) : null;
}

type LeadUser = Pick<User, "id" | "telegramId" | "firstName" | "lastName" | "username" | "phone"> & { lastProduct?: string | null };

/**
 * true — CRM qabul qildi; false — yuborilmadi (o'chiq, telefon yo'q yoki barcha urinishlar xato).
 * yonalish berilmasa — foydalanuvchining oxirgi kursidan (lastProduct) olinadi.
 */
export async function sendLeadToCrm(user: LeadUser, opts: SendOptions & { yonalish?: string | null } = {}): Promise<boolean> {
  const url = opts.url ?? config.CRM_WEBHOOK_URL;
  if (!url || !user.phone) return false;
  const telegramId = user.telegramId.toString();
  // Yo'nalish oldindan ma'lum bo'lsa — darhol eslab qolinadi (keyingi /course so'rovi takrorlanmasin)
  if (opts.yonalish !== undefined) rememberCourse(telegramId, opts.yonalish);
  const yonalish = opts.yonalish !== undefined ? opts.yonalish : await courseOfUser(user);
  rememberCourse(telegramId, yonalish);
  const payload = buildLeadPayload(user, yonalish);
  if (!payload) return false;
  return postToCrm(url, payload, "lid", { telegramId }, opts);
}

export function courseWebhookUrl(): string | undefined {
  if (config.CRM_COURSE_WEBHOOK_URL) return config.CRM_COURSE_WEBHOOK_URL;
  return config.CRM_WEBHOOK_URL ? `${config.CRM_WEBHOOK_URL.replace(/\/+$/, "")}/course` : undefined;
}

/**
 * Lid yuborilgandan keyin mijoz yo'nalishni (kursni) tanlasa: { telegram_id, yonalish } CRM'ga.
 * Faqat telefoni bor (lidi CRM'da bor) mijoz uchun; o'sha yo'nalish allaqachon yuborilgan bo'lsa — yuborilmaydi.
 * CRM lidni topmasa (404) — lid shu yo'nalish bilan yuboriladi.
 */
export async function sendCourseToCrm(user: LeadUser, courseTitle: string, opts: SendOptions & { leadUrl?: string } = {}): Promise<boolean> {
  const url = opts.url ?? courseWebhookUrl();
  if (!url || !user.phone) return false;
  const telegramId = user.telegramId.toString();
  const yonalish = crmCourseName(courseTitle);
  if (sentCourse.get(telegramId) === yonalish) return true;
  rememberCourse(telegramId, yonalish);

  const res = await postToCrmStatus(url, { telegram_id: telegramId, yonalish }, "yo'nalish", { telegramId, yonalish }, opts);
  if (res.ok) return true;
  if (res.status === 404) {
    return sendLeadToCrm(user, { url: opts.leadUrl, fetchImpl: opts.fetchImpl, retryDelayMs: opts.retryDelayMs, yonalish });
  }
  // Yuborilmadi — keyingi safar qayta urinish uchun unutiladi
  if (sentCourse.get(telegramId) === yonalish) sentCourse.delete(telegramId);
  return false;
}
