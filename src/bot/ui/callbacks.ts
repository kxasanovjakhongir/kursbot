import type { Lang } from "../../i18n";

/** Kurs sahifasi bo'limlari (botdagi tugmalar) */
export const COURSE_SECTIONS = ["about", "price", "program", "teacher"] as const;
export type CourseSection = (typeof COURSE_SECTIONS)[number];

/**
 * Inline tugmalar callback_data si — bir joyda. Telegram limiti: 64 bayt.
 * Eski xabarlardagi tugmalar ishlashda davom etishi uchun mavjud prefikslar (p:, buy:, pay:, link:, ...) o'zgartirilmagan.
 */
export const CB = {
  noop: "noop",
  home: "nav:home",
  catalog: (page = 1) => `nav:cat:${page}`,
  purchases: (page = 1) => `nav:pur:${page}`,
  profile: "nav:profile",
  settings: "nav:settings",
  language: "nav:lang",
  help: "nav:help",
  notifications: (page = 1) => `nav:notif:${page}`,

  setLang: (lang: Lang) => `set:lang:${lang}`,
  toggleNews: "set:news",
  changePhone: "set:phone",

  product: (code: string) => `p:${code}`,
  /** Kurs bo'limi: about | price | program | teacher */
  productInfo: (code: string, section: CourseSection) => `pi:${code}:${section}`,
  buy: (code: string) => `buy:${code}`,
  pay: (orderId: bigint) => `pay:${orderId}`,
  cancelOrder: (orderId: bigint) => `ord:cancel:${orderId}`,
  cancelOrderConfirm: (orderId: bigint) => `ord:cancel_ok:${orderId}`,
  link: (grantId: bigint) => `link:${grantId}`,
  contact: "contact",
  resend: "resend",

  admin: "ap:home",
  adminStats: "ap:stats",
  adminProducts: "ap:products",
  adminCards: "ap:cards",
  adminAdmins: "ap:admins",
  adminHelp: "ap:help",
  adminPending: "adm:pending",
} as const;

/** Callback dagi raqamli ID: bigint ga sig'maydigan yoki noto'g'ri qiymatlar rad etiladi */
export const ID_RE = "(\\d{1,18})";
/** Sahifa raqami */
export const PAGE_RE = "(\\d{1,4})";
