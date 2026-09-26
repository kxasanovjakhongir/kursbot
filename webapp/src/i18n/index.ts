import { ApiError } from "../lib/api";
import type { Lang } from "../lib/types";
import { en } from "./en";
import { ru } from "./ru";
import { uz, type MessageKey, type Messages } from "./uz";

export type { MessageKey };
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const LOCALES: Record<Lang, Messages> = { uz, ru, en };

export const LANG_NAMES: Record<Lang, string> = { uz: "🇺🇿 O'zbekcha", ru: "🇷🇺 Русский", en: "🇬🇧 English" };
export const LANGS = Object.keys(LANG_NAMES) as Lang[];

/** Kirishdan oldin (backend tilni aytmaguncha) — Telegram tilidan taxmin */
export function guessLang(code: string | undefined): Lang {
  const base = code?.slice(0, 2);
  return base === "ru" || base === "en" ? base : "uz";
}

export function translator(lang: Lang): Translate {
  return (key, vars) => {
    const template = LOCALES[lang][key] ?? uz[key];
    return vars ? template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : template;
  };
}

const CODE_KEYS: Record<string, MessageKey> = {
  phone_required: "err_phone_required",
  already_owned: "err_already_owned",
  partial_owned: "err_partial_owned",
  payment_unavailable: "err_payment_unavailable",
  bot_blocked: "err_bot_blocked",
  file_type: "err_file_type",
  file_required: "err_file_type",
  file_too_big: "err_file_too_big",
  under_review: "err_under_review",
  closed: "err_closed",
  max_attempts: "err_max_attempts",
  cannot_cancel: "err_cannot_cancel",
  link_failed: "err_link_failed",
  not_found: "err_not_found",
  forbidden: "err_forbidden",
  already_reviewed: "err_already_reviewed",
  network: "error_network",
  rate_limited: "err_rate_limited",
};

/** Xatoni foydalanuvchi tilidagi tushunarli matnga aylantiradi (texnik tafsilotsiz) */
export function errorText(t: Translate, err: unknown): string {
  if (err instanceof ApiError) {
    const key = err.code ? CODE_KEYS[err.code] : undefined;
    if (key) return t(key);
    // Validatsiya xatolari (400) backend matni bilan — ular foydalanuvchi uchun yozilgan
    if (err.status === 400 && err.message) return err.message;
  }
  return t("error_generic");
}
