import type { TextKey } from "./locales/uz";

/**
 * Admin panel → "Bot matnlari": botning tayyor xabar shablonlari bo'limlarga ajratilgan.
 * Tugma yozuvlari (btn_*, menu_* va h.k.) bu yerda yo'q — pastki menyu tugmasi bosilganda matn aynan
 * fayldagi yozuvga solishtiriladi, shuning uchun ular faqat koddan o'zgaradi.
 *
 * format:
 * - "html"  — oddiy xabar (Telegram HTML: <b>, <i>, <u>, <code>, <a href>);
 * - "popup" — tugma bosilganda chiqadigan qisqa oyna: formatlashsiz, 200 belgigacha;
 * - "part"  — boshqa xabarning bir qismi (masalan, rad etish sababi yoki video izohi).
 */
export type TextFormat = "html" | "popup" | "part";

export interface TextMeta {
  title: string;
  hint?: string;
  format?: TextFormat;
  /** Standart matnda bo'lmasa ham kod uzatadigan qo'shimcha o'zgaruvchilar (admin ishlatishi mumkin) */
  vars?: readonly string[];
  /** Matnda bo'lishi shart bo'lgan o'zgaruvchilar */
  required?: readonly string[];
  max?: number;
}

export interface TextGroup {
  id: string;
  title: string;
  description: string;
  keys: Partial<Record<TextKey, TextMeta>>;
}

/** To'lov ko'rsatmalariga ham to'lov sarlavhasidagi qiymatlar uzatiladi (catalog.ts → paymentScreen) */
const PAYMENT_VARS = ["raqam", "mahsulot", "summa", "karta", "karta_egasi"] as const;

export const TEXT_GROUPS: TextGroup[] = [
  {
    id: "start",
    title: "Boshlash va telefon",
    description: "/start, salomlashuv, kampaniya havolasi va telefon raqami so'rash",
    keys: {
      welcome: { title: "Salomlashuv (yangi foydalanuvchi)", hint: "Admin paneldagi «Welcome message» bo'sh bo'lsa ishlatiladi" },
      welcome_back: { title: "Salomlashuv (qaytgan foydalanuvchi)" },
      welcome_phone: { title: "Telefon so'rash (kurs havolasi orqali kelganda)" },
      welcome_phone_generic: { title: "Telefon so'rash (oddiy /start)" },
      link_welcome: { title: "Kampaniya havolasi orqali kelganda" },
      link_unavailable: { title: "Havola noto'g'ri yoki eskirgan" },
      phone_own_only: { title: "Faqat o'z raqamini yuborish kerak" },
      phone_saved: { title: "Raqam saqlandi" },
      phone_update_prompt: { title: "Raqamni yangilash taklifi" },
      phone_updated: { title: "Raqam yangilandi" },
      home_title: { title: "Bosh menyu" },
    },
  },
  {
    id: "courses",
    title: "Kurslar",
    description: "Darsliklar ro'yxati, kurs kartochkasi, tanishtiruv videosi va kurs bo'limlari",
    keys: {
      choose_product: { title: "Darsliklar ro'yxati sarlavhasi" },
      no_products: { title: "Sotuvda darslik yo'q" },
      intro_video_title: { title: "Tanishtiruv videosi — sarlavha", format: "part", max: 200, hint: "Video izohining birinchi qatori" },
      intro_video_text: { title: "Kurs tanishtiruv matni", format: "part", max: 800, vars: ["mahsulot"], hint: "Video izohida sarlavhadan keyin chiqadi" },
      product_caption: { title: "Kurs kartochkasi" },
      course_about_title: { title: "«Kurs haqida» — sarlavha" },
      course_fact_duration: { title: "«Kurs haqida» — davomiyligi", format: "part" },
      course_fact_lessons: { title: "«Kurs haqida» — darslar soni", format: "part" },
      course_fact_start: { title: "«Kurs haqida» — boshlanish sanasi", format: "part" },
      course_fact_audience: { title: "«Kurs haqida» — kimlar uchun", format: "part" },
      course_fact_benefits: { title: "«Kurs haqida» — afzalliklari", format: "part" },
      course_price: { title: "«Narxi» bo'limi" },
      course_program: { title: "«Dastur» bo'limi" },
      course_teacher: { title: "«O'qituvchi» bo'limi" },
      already_owned: { title: "Kurs allaqachon olingan" },
      bundle_partial: { title: "To'plamdagi kurslardan biri bor" },
    },
  },
  {
    id: "lessons",
    title: "Darslar",
    description: "Sotib olingan kurs darslari va yopiq darslar",
    keys: {
      course_owned: { title: "Sotib olingan kurs" },
      course_lessons_hint: { title: "Darslar soni va tanlash", format: "part" },
      course_no_lessons: { title: "Darslar hali yo'q", format: "part" },
      course_bundle_owned: { title: "Sotib olingan to'plam" },
      lessons_title: { title: "Yopiq darslar ro'yxati" },
      lesson_locked: { title: "Yopiq dars bosilganda", format: "popup" },
      lesson_sending: { title: "Video yuborilmoqda", format: "popup" },
      lesson_unavailable: { title: "Video mavjud emas" },
    },
  },
  {
    id: "payment",
    title: "Buyurtma va to'lov",
    description: "To'lov ma'lumoti, ko'rsatmalar, muddat va buyurtmani bekor qilish",
    keys: {
      payment_info: { title: "To'lov ma'lumoti — sarlavha", hint: "Buyurtma raqami, kurs, summa va karta" },
      payment_step_1: { title: "To'lov ko'rsatmasi 1", format: "part", max: 500, vars: PAYMENT_VARS },
      payment_step_2: { title: "To'lov ko'rsatmasi 2", format: "part", max: 500, vars: PAYMENT_VARS },
      payment_expires: {
        title: "To'lov muddati shabloni",
        format: "part",
        max: 300,
        required: ["expires_at"],
        hint: "{expires_at} avtomatik ravishda buyurtmaning haqiqiy muddati bilan almashtiriladi",
      },
      payment_info_shortfall: { title: "Oldingi to'lov kam bo'lganda", format: "part" },
      payment_under_review: { title: "Chek tekshirilmoqda (to'lov ekrani)" },
      payment_unavailable: { title: "To'lov ma'lumoti tayyor emas" },
      order_cancel_confirm: { title: "Bekor qilishni tasdiqlash" },
      order_cancelled: { title: "Buyurtma bekor qilindi" },
      order_cancel_failed: { title: "Bekor qilib bo'lmaydi", format: "popup" },
      order_cancelled_by_admin: { title: "Admin bekor qildi" },
      order_refunded_by_admin: { title: "Admin bekor qildi (pul qaytarildi)" },
      order_cancel_reason: { title: "Bekor qilish sababi", format: "part" },
    },
  },
  {
    id: "receipt",
    title: "Chek",
    description: "Chek yuborish va qabul qilish",
    keys: {
      receipt_received: { title: "Chek qabul qilindi" },
      receipt_received_offhours: { title: "Chek qabul qilindi (ish vaqtidan tashqari)" },
      receipt_invalid: { title: "Chek emas (rasm yoki PDF kerak)" },
      receipt_too_big: { title: "Fayl juda katta" },
      receipt_under_review: { title: "Chek allaqachon tekshirilmoqda" },
      receipt_max_attempts: { title: "Urinishlar tugadi" },
      receipt_which_product: { title: "Chek qaysi darslik uchun?" },
      receipt_which_order: { title: "Chek qaysi buyurtma uchun?" },
      receipt_order_closed: { title: "Buyurtma yopilgan" },
      resend_hint: { title: "Chekni qayta yuborish" },
    },
  },
  {
    id: "review",
    title: "Tasdiqlash va rad etish",
    description: "Admin chekni tasdiqlaganda yoki rad etganda mijozga boradigan xabarlar",
    keys: {
      approved: { title: "To'lov tasdiqlandi" },
      approved_no_link: { title: "To'lov tasdiqlandi (kanal linki keyinroq)" },
      rejected: { title: "Chek rad etildi", hint: "{sabab} — quyidagi sabablardan biri" },
      reject_unreadable: { title: "Sabab: chek o'qilmaydi", format: "part" },
      reject_short: { title: "Sabab: summa kam", format: "part" },
      reject_wrong_card: { title: "Sabab: boshqa kartaga", format: "part" },
      reject_not_found: { title: "Sabab: to'lov topilmadi", format: "part" },
      reject_fake: { title: "Sabab: soxta chek", format: "part" },
      reject_other: { title: "Sabab: boshqa (admin yozgan matn)", format: "part" },
    },
  },
  {
    id: "access",
    title: "Kanal va kirish",
    description: "Yopiq kanalga kirish, muddat va havolalar",
    keys: {
      joined_welcome: { title: "Kanalga qo'shildi" },
      access_expiring: { title: "Kirish muddati tugayapti" },
      access_expired: { title: "Kirish muddati tugadi" },
      access_removed: { title: "Kanaldan chiqarildi" },
      access_extended: { title: "Kirish uzaytirildi" },
      access_unlimited: { title: "Kirish muddatsiz" },
      access_restored: { title: "Kirish tiklandi" },
      link_refreshed: { title: "Yangi kanal havolasi tayyor" },
      link_loading: { title: "Havola tayyorlanmoqda", format: "popup" },
      link_failed: { title: "Havolani olib bo'lmadi" },
    },
  },
  {
    id: "help",
    title: "Yordam",
    description: "«💬 Yordam» bosilganda keladigan xabar va admin bilan bog'lanish",
    keys: {
      help: { title: "Yordam xabari", hint: "«💬 Yordam» tugmasi yoki /help bosilganda chiqadi" },
      contact_admin_hint: { title: "Admin bilan bog'lanish", hint: "{kontakt} — support username (@...)" },
      support_not_configured: { title: "Yordam sozlanmagan" },
    },
  },
  {
    id: "profile",
    title: "Profil va sozlamalar",
    description: "Profil, bildirishnomalar, til va yangiliklar",
    keys: {
      profile: { title: "Profil" },
      notifications_title: { title: "Bildirishnomalar — sarlavha" },
      notifications_empty: { title: "Bildirishnomalar yo'q" },
      admin_message: { title: "Admin xabari" },
      settings: { title: "Sozlamalar" },
      news_on: { title: "Yangiliklar: yoqilgan", format: "popup" },
      news_off: { title: "Yangiliklar: o'chirilgan", format: "popup" },
      language_title: { title: "Til tanlash" },
      language_changed: { title: "Til o'zgartirildi" },
      action_cancelled: { title: "Amal bekor qilindi" },
    },
  },
  {
    id: "errors",
    title: "Xatolar va tizim",
    description: "Xatolik, cheklov va texnik xizmat xabarlari",
    keys: {
      error_generic: { title: "Umumiy xatolik" },
      error_database: { title: "Ma'lumotlar bazasi xatosi" },
      error_unknown_command: { title: "Noma'lum buyruq" },
      error_not_found: { title: "Ma'lumot topilmadi", format: "popup" },
      error_stale_button: { title: "Eskirgan tugma", format: "popup" },
      error_too_many: { title: "Juda ko'p so'rov" },
      error_banned: { title: "Foydalanuvchi cheklangan" },
      maintenance: { title: "Texnik xizmat (maintenance)" },
    },
  },
  {
    id: "admin",
    title: "Admin (botda)",
    description: "Botdagi /admin bo'limi xabarlari",
    keys: {
      adm_title: { title: "Admin panel" },
      adm_stats: { title: "Statistika" },
      adm_no_permission: { title: "Ruxsat yo'q", format: "popup" },
    },
  },
];

export const POPUP_MAX = 200;
/** Oddiy xabar: Telegram limiti 4096, o'zgaruvchilar (kurs nomi, tavsif) uchun joy qoldiriladi */
export const MESSAGE_MAX = 3500;
/** Boshqa xabar ichiga qo'shiladigan qism */
export const PART_MAX = 1000;

export function textMeta(key: string): { group: TextGroup; meta: TextMeta } | null {
  for (const group of TEXT_GROUPS) {
    const meta = group.keys[key as TextKey];
    if (meta) return { group, meta };
  }
  return null;
}

export function textMax(meta: TextMeta): number {
  return meta.max ?? (meta.format === "popup" ? POPUP_MAX : meta.format === "part" ? PART_MAX : MESSAGE_MAX);
}

export const EDITABLE_TEXT_KEYS = TEXT_GROUPS.flatMap((g) => Object.keys(g.keys) as TextKey[]);
