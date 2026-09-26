import { prisma } from "../db";
import { escapeHtml } from "../lib/format";
import { en } from "./locales/en";
import { ru } from "./locales/ru";
import { uz, type Messages, type TextKey } from "./locales/uz";

export type { Messages, TextKey };

export const LANGS = ["uz", "ru", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "uz";

export const LOCALES: Record<Lang, Messages> = { uz, ru, en };

/** Til tanlash tugmalarida ko'rinadigan nomlar (har doim o'z tilida) */
export const LANG_NAMES: Record<Lang, string> = {
  uz: "🇺🇿 O'zbekcha",
  ru: "🇷🇺 Русский",
  en: "🇬🇧 English",
};

export function isLang(x: unknown): x is Lang {
  return typeof x === "string" && (LANGS as readonly string[]).includes(x);
}

/** Telegram language_code dan taxminiy til (foydalanuvchi bazada hali yo'q paytda) */
export function guessLang(code: string | undefined | null): Lang {
  const base = code?.slice(0, 2).toLowerCase();
  return isLang(base) ? base : DEFAULT_LANG;
}

// ---------- Bazadagi override'lar (texts jadvali: key + lang) ----------

// TTL: boshqa instansda paneldan o'zgartirilgan matn ham ko'pi bilan 30 soniyada ko'rinadi
const OVERRIDES_TTL_MS = 30_000;
let overrides: { map: Map<string, string>; at: number } | null = null;
let loading: Promise<Map<string, string>> | null = null;
let generation = 0;

async function loadOverrides(): Promise<Map<string, string>> {
  if (overrides && Date.now() - overrides.at < OVERRIDES_TTL_MS) return overrides.map;
  if (!loading) {
    const gen = generation;
    loading = prisma.text
      .findMany()
      .then((rows) => {
        const map = new Map(rows.map((r) => [`${r.lang}:${r.key}`, r.body]));
        if (gen === generation) overrides = { map, at: Date.now() };
        return map;
      })
      .finally(() => (loading = null));
  }
  return loading;
}

export function invalidateTexts(): void {
  generation++;
  overrides = null;
  loading = null;
}

export type Vars = Record<string, string | number>;

/** Oddiy qiymatlar HTML-escape qilinadi; `raw` dagilar esa tayyor HTML sifatida qo'yiladi */
export function fill(template: string, vars: Vars = {}, raw: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (k in raw) return raw[k];
    if (k in vars) return escapeHtml(String(vars[k]));
    return m;
  });
}

/** Matn: avval bazadagi override, keyin shu tilning fayli, oxiri o'zbekcha */
export async function translate(lang: Lang, key: TextKey, vars?: Vars, raw?: Record<string, string>): Promise<string> {
  const o = await loadOverrides();
  const template = o.get(`${lang}:${key}`) ?? LOCALES[lang][key] ?? uz[key];
  return fill(template, vars, raw);
}

/**
 * Tugma yozuvlari — sinxron, faqat fayldan (override qilinmaydi):
 * reply-klaviatura tugmasi bosilganda matn aynan shu yozuvga solishtiriladi.
 */
export function label(lang: Lang, key: TextKey, vars?: Vars): string {
  const template = LOCALES[lang][key] ?? uz[key];
  return vars ? template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : template;
}

/** Barcha tillardagi yozuvlar — `hears` uchun (foydalanuvchi tilni almashtirsa ham eski klaviatura ishlaydi) */
export function allLabels(key: TextKey): string[] {
  return [...new Set(LANGS.map((l) => LOCALES[l][key]))];
}
