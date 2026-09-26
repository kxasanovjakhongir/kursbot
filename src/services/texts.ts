import { DEFAULT_LANG, fill, invalidateTexts, LOCALES, translate, type TextKey, type Vars } from "../i18n";

/**
 * Bot xabarlari (TZ Ilova A). Matnlar src/i18n/locales/* da, bu fayl eski importlar uchun fasad.
 * Bazadagi `texts` jadvali matnlarni til bo'yicha ustidan yozadi (3-bosqich: "Matnlar" bo'limi).
 */
export const DEFAULT_TEXTS = LOCALES[DEFAULT_LANG];
export type { TextKey };
export { fill, invalidateTexts };

/** Standart tildagi matn (admin guruhi va til aniqlanmagan joylar uchun) */
export async function t(key: TextKey, vars?: Vars, raw?: Record<string, string>): Promise<string> {
  return translate(DEFAULT_LANG, key, vars, raw);
}

/** Rad etish sabablari (TZ 7.3). label — adminlar uchun, mijozga boradigan matn — `textKey` (lokalizatsiya qilingan) */
export const REJECT_REASONS = {
  unreadable: { label: "Chek o'qilmaydi", textKey: "reject_unreadable", resend: true },
  short: { label: "Summa kam", textKey: "reject_short", resend: true },
  wrong_card: { label: "Boshqa kartaga", textKey: "reject_wrong_card", resend: false },
  not_found: { label: "To'lov topilmadi", textKey: "reject_not_found", resend: false },
  fake: { label: "Eski yoki soxta chek", textKey: "reject_fake", resend: false },
  other: { label: "Boshqa", textKey: "reject_other", resend: true },
} as const satisfies Record<string, { label: string; textKey: TextKey; resend: boolean }>;

export type RejectReasonCode = keyof typeof REJECT_REASONS;

export function isRejectReason(code: string): code is RejectReasonCode {
  return code in REJECT_REASONS;
}
