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

/**
 * Paneldan o'chirilgan matnlar (settings jadvali, barcha tillar uchun). O'chirilgan yoki bo'sh saqlangan matn
 * bo'sh satr bo'lib qaytadi — bunday xabar yuborilmaydi (bot/emptyText.ts), xabar qismi esa tushib qoladi.
 */
export const DISABLED_TEXTS_KEY = "disabled_texts";

interface Overrides {
  map: Map<string, string>;
  disabled: Set<string>;
}

// TTL: boshqa instansda paneldan o'zgartirilgan matn ham ko'pi bilan 30 soniyada ko'rinadi
const OVERRIDES_TTL_MS = 30_000;
let overrides: (Overrides & { at: number }) | null = null;
let loading: Promise<Overrides> | null = null;
let generation = 0;

async function loadOverrides(): Promise<Overrides> {
  if (overrides && Date.now() - overrides.at < OVERRIDES_TTL_MS) return overrides;
  if (!loading) {
    const gen = generation;
    loading = Promise.all([prisma.text.findMany(), prisma.setting.findUnique({ where: { key: DISABLED_TEXTS_KEY } })])
      .then(([rows, setting]) => {
        const map = new Map(rows.map((r) => [`${r.lang}:${r.key}`, r.body]));
        const disabled = new Set(Array.isArray(setting?.value) ? setting.value.map(String) : []);
        if (gen === generation) overrides = { map, disabled, at: Date.now() };
        return { map, disabled };
      })
      .finally(() => (loading = null));
  }
  return loading;
}

function template(o: Overrides | null, lang: Lang, key: TextKey): string {
  if (o?.disabled.has(key)) return "";
  return o?.map.get(`${lang}:${key}`) ?? LOCALES[lang][key] ?? uz[key];
}

/** Bo'sh bo'lmagan qismlarni birlashtiradi — o'chirilgan qism o'rnida ortiqcha bo'sh qator qolmaydi */
export function joinParts(parts: (string | null | undefined | false)[], separator = "\n\n"): string {
  return parts.filter((p): p is string => typeof p === "string" && p.trim() !== "").join(separator);
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
  return fill(template(await loadOverrides(), lang, key), vars, raw);
}

/** Admin paneldan shu tildagi matn o'zgartirilganmi (bazada override bor) */
export async function hasTextOverride(lang: Lang, key: TextKey): Promise<boolean> {
  return (await loadOverrides()).map.has(`${lang}:${key}`);
}

/**
 * Bazaga bormasdan matn: keshdagi override (muddati o'tgan bo'lsa ham) yoki fayldagi standart.
 * Xato ushlagich va spam himoyasi uchun — baza ishlamay qolganda ham javob berishi kerak.
 */
export function cachedText(lang: Lang, key: TextKey): string {
  return template(overrides, lang, key);
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
