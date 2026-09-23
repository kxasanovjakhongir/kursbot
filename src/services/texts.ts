import { prisma } from "../db";
import { escapeHtml } from "../lib/format";

/**
 * Bot xabarlari (TZ Ilova A). HTML formatida. {kalit} lar avtomatik to'ldiriladi.
 * Bazadagi `texts` jadvali bu matnlarni ustidan yozadi (3-bosqich: "Matnlar" bo'limi).
 */
export const DEFAULT_TEXTS = {
  welcome_phone:
    "Assalomu alaykum, {ism}!\n{mahsulot} haqida to'liq ma'lumot olish uchun pastdagi tugma orqali telefon raqamingizni yuboring.\n\n<i>Raqamingiz faqat xarid bo'yicha bog'lanish uchun ishlatiladi.</i>",
  welcome_phone_generic:
    "Assalomu alaykum, {ism}!\nDavom etish uchun pastdagi tugma orqali telefon raqamingizni yuboring.\n\n<i>Raqamingiz faqat xarid bo'yicha bog'lanish uchun ishlatiladi.</i>",
  phone_button: "📱 Raqamni yuborish",
  phone_own_only: "Iltimos, pastdagi tugma orqali <b>o'z</b> raqamingizni yuboring.",
  phone_saved: "Rahmat! ✅",
  choose_product: "Assalomu alaykum, {ism}!\nQaysi darslik sizni qiziqtiradi? 👇",
  product_caption: "<b>{mahsulot}</b>\n{tavsif}\n\nNarxi: {narx_qator}",
  btn_buy: "✅ Darslikni olaman",
  btn_ask: "💬 Savol berish",
  payment_info:
    "Buyurtma #{raqam}\nSumma: <b>{summa}</b>\nKarta: <code>{karta}</code>\nEgasi: {karta_egasi}\n\nTo'lovni amalga oshiring va <b>chek rasmini shu yerga yuboring</b>.\nBuyurtma {muddat} gacha amal qiladi.",
  payment_info_shortfall: "\n\n⚠️ Oldingi to'lovda <b>{farq}</b> kam edi. Qolgan summani o'tkazib, chekni yuboring.",
  payment_under_review: "Buyurtma #{raqam} bo'yicha chekingiz tekshirilmoqda. Tez orada javob beramiz.",
  payment_unavailable: "Kechirasiz, to'lov ma'lumotlari hozircha tayyor emas. Admin tez orada siz bilan bog'lanadi.",
  receipt_received: "Rahmat! Chekingiz qabul qilindi ✅\nAdmin 15 daqiqa ichida tekshiradi va sizga kanal linkini yuboramiz.",
  receipt_received_offhours:
    "Rahmat! Chekingiz qabul qilindi ✅\nHozir ish vaqtidan tashqari — chekingiz ertaga soat {ish_boshi} dan keyin tekshiriladi.",
  receipt_invalid: "Iltimos, to'lov chekining rasmini yoki PDF faylini yuboring.",
  receipt_too_big: "Fayl hajmi {mb} MB dan oshmasligi kerak. Iltimos, chek rasmini yuboring.",
  receipt_under_review: "Chekingiz allaqachon tekshirilmoqda. Iltimos, biroz kuting.",
  receipt_max_attempts: "Bu buyurtma uchun chek yuborish urinishlari tugadi. Iltimos, admin bilan bog'laning.",
  receipt_which_product: "Bu chek qaysi darslik uchun?",
  receipt_which_order: "Bu chek qaysi buyurtma uchun?",
  receipt_order_closed: "Bu buyurtma yopilgan. Darslikni qaytadan tanlab, yangi buyurtma oching.",
  approved:
    "To'lovingiz tasdiqlandi 🎉\nQuyidagi tugma orqali yopiq kanalga qo'shiling. Link faqat siz uchun va {kun} kun amal qiladi.",
  approved_no_link: "To'lovingiz tasdiqlandi 🎉\nKanal linkini admin tez orada yuboradi.",
  btn_join: "➡️ Kanalga qo'shilish: {mahsulot}",
  rejected: "Afsuski, chekingiz tasdiqlanmadi.\nSabab: {sabab}",
  btn_resend: "🔁 Chekni qayta yuborish",
  btn_contact_admin: "👤 Admin bilan bog'lanish",
  resend_hint: "Chek rasmini yoki PDF faylini shu yerga yuboring.",
  contact_admin_hint: "Admin bilan bog'lanish uchun: {kontakt}",
  joined_welcome: "Xush kelibsiz! 🎉 {mahsulot} kanaldagi birinchi postdan boshlanadi.",
  already_owned: "Siz bu darslikni olgansiz ✅\nKanal linkini «Mening xaridlarim» bo'limidan qayta olishingiz mumkin.",
  btn_get_link: "🔗 Linkni qayta olish",
  bundle_partial: "Sizda to'plamdagi darsliklardan biri allaqachon bor. Yetishmayotgan darslik:",
  menu_products: "📚 Darsliklar",
  menu_purchases: "🧾 Mening xaridlarim",
  purchases_empty: "Sizda hali xaridlar yo'q.",
  purchases_header: "<b>Mening xaridlarim</b>",
  link_refreshed: "Yangi link tayyor. Link faqat siz uchun.",
  no_products: "Hozircha sotuvda darsliklar yo'q.",
  maintenance: "Tizim vaqtincha texnik xizmatda. Iltimos, keyinroq urinib ko'ring.",
} as const;

export type TextKey = keyof typeof DEFAULT_TEXTS;

let overrides: Map<string, string> | null = null;

async function loadOverrides(): Promise<Map<string, string>> {
  if (overrides) return overrides;
  const rows = await prisma.text.findMany({ where: { lang: "uz" } });
  overrides = new Map(rows.map((r) => [r.key, r.body]));
  return overrides;
}

export function invalidateTexts(): void {
  overrides = null;
}

/** Oddiy qiymatlar HTML-escape qilinadi; `raw` dagilar esa tayyor HTML sifatida qo'yiladi */
export function fill(template: string, vars: Record<string, string | number> = {}, raw: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (k in raw) return raw[k];
    if (k in vars) return escapeHtml(String(vars[k]));
    return m;
  });
}

export async function t(key: TextKey, vars?: Record<string, string | number>, raw?: Record<string, string>): Promise<string> {
  const o = await loadOverrides();
  return fill(o.get(key) ?? DEFAULT_TEXTS[key], vars, raw);
}

/** Rad etish sabablari (TZ 7.3) */
export const REJECT_REASONS = {
  unreadable: { label: "Chek o'qilmaydi", text: "Chek rasmi aniq emas, iltimos, to'liq skrinshot yuboring", resend: true },
  short: { label: "Summa kam", text: "To'lov summasi {farq} kam. Qolgan summani o'tkazib, chekni yuboring", resend: true },
  wrong_card: { label: "Boshqa kartaga", text: "To'lov boshqa kartaga o'tkazilgan. Ko'rsatilgan kartani tekshiring", resend: false },
  not_found: { label: "To'lov topilmadi", text: "Bu to'lov kartaga kelib tushmagan", resend: false },
  fake: { label: "Eski yoki soxta chek", text: "Chek tasdiqlanmadi. Savollar bo'lsa, admin bilan bog'laning", resend: false },
  other: { label: "Boshqa", text: "{matn}", resend: true },
} as const;

export type RejectReasonCode = keyof typeof REJECT_REASONS;

export function isRejectReason(code: string): code is RejectReasonCode {
  return code in REJECT_REASONS;
}
