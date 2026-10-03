/**
 * Telegram username: 5–32 belgi, lotin harfi bilan boshlanadi, faqat A-Z a-z 0-9 _,
 * ketma-ket "__" yo'q va "_" bilan tugamaydi.
 */
export const TELEGRAM_USERNAME_RE = /^[a-zA-Z](?:[a-zA-Z0-9]|_(?!_)){3,30}[a-zA-Z0-9]$/;

export const TELEGRAM_USERNAME_ERROR = "Telegram username noto'g'ri formatda.";

/**
 * Admin kiritgan qiymatni toza username'ga keltiradi: "@support", "support",
 * "https://t.me/support", "t.me/support" → "support". Yaroqsiz bo'lsa null.
 */
export function normalizeTelegramUsername(raw: string): string | null {
  let s = raw.trim();
  s = s.replace(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//i, "");
  s = s.replace(/^@/, "");
  return TELEGRAM_USERNAME_RE.test(s) ? s : null;
}
