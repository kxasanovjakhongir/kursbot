import { DEFAULT_LANG, DISABLED_TEXTS_KEY, fill, invalidateTexts, LANGS, LOCALES, translate, type Lang, type TextKey, type Vars } from "../i18n";
import { EDITABLE_TEXT_KEYS, TEXT_GROUPS, textMax, textMeta, type TextFormat, type TextMeta } from "../i18n/catalog";
import { prisma } from "../db";
import { telegramHtmlError, templateVars } from "../lib/telegramHtml";

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

// ---------- Admin paneldan tahrirlanadigan matnlar (texts jadvali: key + lang override) ----------

export { EDITABLE_TEXT_KEYS };

/** Standart matnlardagi o'zgaruvchilar (barcha tillar bo'yicha) — admin faqat shularni ishlata oladi */
export function textVars(key: TextKey): string[] {
  return [...new Set([...LANGS.flatMap((l) => templateVars(LOCALES[l][key])), ...(textMeta(key)?.meta.vars ?? [])])];
}

export function isEditableText(key: string): key is TextKey {
  return textMeta(key) !== null;
}

export interface EditableTextItem {
  key: TextKey;
  group: string;
  title: string;
  hint: string | null;
  format: TextFormat;
  vars: string[];
  required: string[];
  max: number;
  value: string;
  default: string;
  overridden: boolean;
  /** Paneldan o'chirilgan (barcha tillarda). Bo'sh saqlangan matn ham yuborilmaydi — `value` bo'sh bo'ladi */
  disabled: boolean;
}

async function disabledTexts(): Promise<Set<string>> {
  const row = await prisma.setting.findUnique({ where: { key: DISABLED_TEXTS_KEY } });
  return new Set(Array.isArray(row?.value) ? row.value.map(String) : []);
}

/** Panel uchun: bo'limlar va har bir matnning joriy qiymati (override yoki standart) */
export async function getEditableTexts(lang: Lang) {
  const rows = await prisma.text.findMany({ where: { lang, key: { in: EDITABLE_TEXT_KEYS } } });
  const overrides = new Map(rows.map((r) => [r.key, r.body]));
  const disabled = await disabledTexts();
  return {
    lang,
    groups: TEXT_GROUPS.map((g) => ({ id: g.id, title: g.title, description: g.description })),
    items: TEXT_GROUPS.flatMap((g) =>
      (Object.entries(g.keys) as [TextKey, TextMeta][]).map(([key, meta]): EditableTextItem => {
        const def = LOCALES[lang][key];
        const value = overrides.get(key) ?? def;
        return {
          key,
          group: g.id,
          title: meta.title,
          hint: meta.hint ?? null,
          format: meta.format ?? "html",
          vars: textVars(key),
          required: [...(meta.required ?? [])],
          max: textMax(meta),
          value,
          default: def,
          overridden: overrides.has(key) && value !== def,
          disabled: disabled.has(key),
        };
      }),
    ),
  };
}

/**
 * Xato matni yoki null. html/part — Telegram HTML, popup — formatlashsiz qisqa matn.
 * Bo'sh matn ruxsat etilgan — bu xabar (yoki xabar qismi) o'chirilgan degani. `required` o'zgaruvchilar
 * majburiy emas (panelda tavsiya sifatida ko'rsatiladi): admin butun matnni o'zi yozishi mumkin.
 */
export function editableTextError(key: TextKey, body: string): string | null {
  const found = textMeta(key);
  if (!found) return "Bu matnni tahrirlab bo'lmaydi.";
  const { meta } = found;
  const max = textMax(meta);
  if (!body.trim()) return null;
  if (body.length > max) return `Matn ${max} belgidan oshmasligi kerak.`;
  const allowed = textVars(key);
  const used = templateVars(body);
  const unknown = used.find((v) => !allowed.includes(v));
  if (unknown) return `Noma'lum o'zgaruvchi {${unknown}}. ${allowed.length ? `Ruxsat etilgan: ${allowed.map((v) => `{${v}}`).join(", ")}.` : "Bu matnda o'zgaruvchi ishlatilmaydi."}`;
  if (meta.format === "popup") return /<[a-zA-Z/]/.test(body) ? "Bu oynada formatlash (HTML teglar) ishlamaydi." : null;
  return telegramHtmlError(body);
}

/**
 * Saqlash: standartga teng bo'lsa override o'chiriladi (keyingi versiyalardagi standart matn
 * o'zgarishlari ham kuchga kiradi). Kesh shu zahoti tozalanadi — bot keyingi xabarda yangi matnni ishlatadi.
 * Faqat bo'sh joydan iborat matn bo'sh satr sifatida saqlanadi (xabar o'chiriladi).
 */
export async function saveEditableTexts(lang: Lang, values: Partial<Record<TextKey, string>>): Promise<TextKey[]> {
  const changed: TextKey[] = [];
  await prisma.$transaction(async (tx) => {
    for (const [key, raw] of Object.entries(values) as [TextKey, string | undefined][]) {
      if (raw === undefined || !isEditableText(key)) continue;
      const body = raw.trim() ? raw : "";
      if (body === LOCALES[lang][key]) await tx.text.deleteMany({ where: { key, lang } });
      else await tx.text.upsert({ where: { key_lang: { key, lang } }, create: { key, lang, body }, update: { body } });
      changed.push(key);
    }
  });
  invalidateTexts();
  return changed;
}

/**
 * Matnni (xabar yoki xabar qismini) yoqish/o'chirish — barcha tillar uchun. Yoqilganda shu tilda bo'sh
 * saqlangan matn standartga qaytadi (aks holda yoqilgan xabar baribir bo'sh bo'lib qolardi).
 */
export async function setTextsEnabled(lang: Lang, values: Partial<Record<TextKey, boolean>>): Promise<string[]> {
  const disabled = await disabledTexts();
  const changed: string[] = [];
  for (const [key, enabled] of Object.entries(values) as [TextKey, boolean | undefined][]) {
    if (enabled === undefined || !isEditableText(key)) continue;
    if (enabled) {
      const empty = await prisma.text.deleteMany({ where: { key, lang, body: "" } });
      if (!disabled.delete(key) && !empty.count) continue;
    } else {
      if (disabled.has(key)) continue;
      disabled.add(key);
    }
    changed.push(`${key}: ${enabled ? "yoqildi" : "o'chirildi"}`);
  }
  if (changed.length) {
    const value = [...disabled].filter(isEditableText).sort();
    await prisma.setting.upsert({ where: { key: DISABLED_TEXTS_KEY }, create: { key: DISABLED_TEXTS_KEY, value }, update: { value } });
  }
  invalidateTexts();
  return changed;
}
