import type { Api } from "grammy";
import { stripHtml } from "../lib/format";

/**
 * Paneldan o'chirilgan yoki bo'sh qoldirilgan matnlar ("Bot matnlari") bo'sh satr bo'lib keladi, Telegram esa
 * bo'sh xabarni qabul qilmaydi. Shu transformer bir joyda hal qiladi:
 *  - tugmasiz xabar — umuman yuborilmaydi;
 *  - tugmali xabar (inline yoki pastki klaviatura) — tugmalar yo'qolmasligi uchun matn o'rniga EMPTY_TEXT_PLACEHOLDER;
 *  - popup (answerCallbackQuery) — oyna chiqmaydi.
 */
export const EMPTY_TEXT_PLACEHOLDER = "👇";

type Payload = Record<string, unknown>;

function hasButtons(markup: unknown): boolean {
  if (!markup || typeof markup !== "object") return false;
  const m = markup as { inline_keyboard?: unknown[][]; keyboard?: unknown[][]; remove_keyboard?: boolean; force_reply?: boolean };
  if (m.inline_keyboard) return m.inline_keyboard.some((row) => row.length > 0);
  return !!m.keyboard?.length || !!m.remove_keyboard || !!m.force_reply;
}

export function installEmptyTextGuard(api: Api): void {
  api.config.use((prev, method, payload, signal) => {
    const p = payload as Payload;
    if (method === "answerCallbackQuery" && typeof p.text === "string" && !stripHtml(p.text).trim()) {
      delete p.text;
      delete p.show_alert;
      return prev(method, payload, signal);
    }
    if ((method !== "sendMessage" && method !== "editMessageText") || typeof p.text !== "string" || stripHtml(p.text).trim()) {
      return prev(method, payload, signal);
    }
    if (hasButtons(p.reply_markup)) {
      p.text = EMPTY_TEXT_PLACEHOLDER;
      return prev(method, payload, signal);
    }
    // Yuborilmadi: chaqiruvchi kod xato olmasligi uchun bo'sh natija (message_id: 0 — haqiqiy xabar emas)
    const result = method === "sendMessage" ? { message_id: 0, date: Math.floor(Date.now() / 1000), chat: { id: Number(p.chat_id), type: "private" }, text: "" } : true;
    return Promise.resolve({ ok: true, result } as unknown as Awaited<ReturnType<typeof prev>>);
  });
}
