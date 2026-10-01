import type { User } from "@prisma/client";
import { config } from "../config";
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
}

export function buildLeadPayload(user: Pick<User, "telegramId" | "firstName" | "lastName" | "username" | "phone">): CrmLeadPayload | null {
  if (!user.phone) return null;
  return {
    first_name: user.firstName ?? "",
    last_name: user.lastName ?? "",
    phone: user.phone.startsWith("+") ? user.phone : `+${user.phone}`,
    telegram_id: user.telegramId.toString(),
    telegram_username: user.username ?? "",
  };
}

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 10_000;

export interface SendOptions {
  url?: string;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

/** true — CRM qabul qildi; false — yuborilmadi (o'chiq, telefon yo'q yoki barcha urinishlar xato) */
export async function sendLeadToCrm(
  user: Pick<User, "id" | "telegramId" | "firstName" | "lastName" | "username" | "phone">,
  opts: SendOptions = {},
): Promise<boolean> {
  const url = opts.url ?? config.CRM_WEBHOOK_URL;
  if (!url) return false;
  const payload = buildLeadPayload(user);
  if (!payload) return false;

  const doFetch = opts.fetchImpl ?? fetch;
  const retryDelayMs = opts.retryDelayMs ?? 2000;
  const body = JSON.stringify(payload);
  // URL ichida maxfiy kalit bor — logga faqat telegramId yoziladi
  const log = logger.child({ crm: true, telegramId: payload.telegram_id });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        log.info({ status: res.status }, "CRM: lid yuborildi");
        return true;
      }
      const text = (await res.text().catch(() => "")).slice(0, 300);
      if (res.status < 500) {
        log.error({ status: res.status, response: text }, "CRM: lid rad etildi");
        return false;
      }
      log.warn({ status: res.status, attempt, response: text }, "CRM: server xatosi");
    } catch (err) {
      log.warn({ err: (err as Error).message, attempt }, "CRM: so'rov yiqildi");
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
  }
  log.error({ attempts: MAX_ATTEMPTS }, "CRM: lid yuborilmadi");
  return false;
}
