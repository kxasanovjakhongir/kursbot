import { label, type TextKey } from "../i18n";
import { getSettings, setSetting } from "./settings";

/**
 * Paneldan («Bot tugmalari») yoqib-o'chiriladigan inline tugmalar, ekranlar bo'yicha.
 *
 * Har bir ekranda ikki xil tugma bor:
 *  - o'z tugmalari (`own`) — faqat shu ekranga xos («Darslikni olaman», «Karta raqamini nusxalash», ...);
 *  - umumiy tugmalar (COMMON) — istalgan ekranga qo'shsa bo'ladi («Darsliklar», «Yordam», «Savol berish», ...).
 *    `on` — standart holatda yoqilganlari, qolganlari paneldan yoqilmaguncha chiqmaydi.
 *
 * Tugma ID si: "<ekran>.<tugma>". Bazada (`button_states`) faqat standartdan farq qiladigan holatlar saqlanadi.
 * Ro'yxat elementlari (kurslar, darslar, tillar) va sahifalash tugma emas — ular doim chiqadi.
 */
export const COMMON_BUTTONS = [
  { id: "products", key: "menu_products" },
  { id: "help", key: "menu_help", hint: "Yordam profiliga (username sozlanmagan bo'lsa — yordam ekraniga)" },
  { id: "ask", key: "btn_ask", hint: "Yordam profiliga; username sozlangan bo'lsa chiqadi" },
  { id: "contact", key: "btn_contact_admin" },
  { id: "profile", key: "menu_profile" },
  { id: "settings", key: "menu_settings" },
  { id: "home", key: "btn_home" },
] as const satisfies readonly { id: string; key: TextKey; hint?: string }[];

export type CommonButton = (typeof COMMON_BUTTONS)[number]["id"];

interface OwnButton {
  id: string;
  key?: TextKey;
  name?: string;
  hint?: string;
}

interface ScreenDef {
  id: string;
  title: string;
  /** Standart holatda yoqilgan umumiy tugmalar */
  on: readonly CommonButton[];
  /** Shu ekranning o'ziga olib boradigan tugma — ro'yxatda ko'rsatilmaydi */
  self?: CommonButton;
  /** Ekranda «⬅️ Orqaga» bor */
  back?: boolean;
  own?: readonly OwnButton[];
}

const BUY: OwnButton = { id: "buy", key: "btn_buy", hint: "O'chirilsa, bu ekrandan xarid qilib bo'lmaydi" };

const SCREENS = [
  { id: "home", title: "🏠 Bosh menyu", on: ["products", "help"], self: "home" },
  { id: "catalog", title: "📚 Darsliklar ro'yxati", on: ["help", "home"], self: "products" },
  {
    id: "product",
    title: "Kurs kartochkasi",
    on: ["ask", "home"],
    own: [
      { id: "sections", name: "Kurs bo'limlari", hint: "«Kurs haqida», «Narxi», «Dastur», «O'qituvchi»" },
      { id: "lessons", name: "🎬 Darslar", hint: "Xarid qilinmagan kursning darslar ro'yxati (🔒)" },
      BUY,
    ],
  },
  { id: "course_section", title: "Kurs bo'limi (Kurs haqida, Narxi, ...)", on: ["home"], back: true, own: [BUY] },
  { id: "lessons_locked", title: "Darslar ro'yxati (xarid qilinmagan)", on: ["home"], back: true, own: [BUY] },
  {
    id: "owned",
    title: "Xarid qilingan kurs",
    on: ["home"],
    back: true,
    own: [{ id: "channel_link", key: "btn_channel_link", hint: "Yopiq kanalga havolani qayta olish" }],
  },
  { id: "payment", title: "To'lov ma'lumoti", on: ["ask", "home"], back: true, own: [
      { id: "pay_payme", key: "btn_pay_payme", hint: "Payme sozlangan bo'lsa (.env)" },
      { id: "pay_click", key: "btn_pay_click", hint: "Click sozlangan bo'lsa (.env)" },
      { id: "copy_card", key: "btn_copy_card" },
    ] },
  { id: "order_cancelled", title: "Buyurtma bekor qilindi", on: ["products", "home"] },
  { id: "help", title: "💬 Yordam ekrani", on: ["contact", "home"], self: "help" },
  {
    id: "profile",
    title: "👤 Profil",
    on: ["settings", "home"],
    self: "profile",
    own: [
      { id: "change_phone", key: "btn_change_phone" },
      { id: "notifications", key: "btn_notifications" },
    ],
  },
  {
    id: "settings",
    title: "⚙️ Sozlamalar",
    on: ["home"],
    self: "settings",
    back: true,
    own: [
      { id: "language", key: "btn_language" },
      { id: "news", name: "🔔 Yangiliklar obunasi", hint: "Yangiliklarni yoqish/o'chirish tugmasi" },
    ],
  },
  { id: "language", title: "🌐 Til tanlash", on: ["home"], back: true },
  { id: "notifications", title: "🔔 Bildirishnomalar", on: ["home"], back: true },
  { id: "notices", title: "Xatolik va bildirishnoma xabarlari", on: ["contact"] },
] as const satisfies readonly ScreenDef[];

export type ScreenId = (typeof SCREENS)[number]["id"];

interface ButtonDef {
  id: string;
  label: string;
  hint: string | null;
  /** Umumiy tugma (istalgan ekranga qo'shiladi) yoki ekranning o'z tugmasi */
  common: boolean;
  default: boolean;
}

function screenButtons(s: ScreenDef): ButtonDef[] {
  const own = [...(s.own ?? []), ...(s.back ? [{ id: "back", key: "btn_back" } satisfies OwnButton] : [])];
  return [
    ...own.map((b) => ({ id: `${s.id}.${b.id}`, label: b.key ? label("uz", b.key) : (b.name ?? b.id), hint: b.hint ?? null, common: false, default: true })),
    ...COMMON_BUTTONS.filter((b) => b.id !== s.self).map((b) => ({
      id: `${s.id}.${b.id}`,
      label: label("uz", b.key),
      hint: "hint" in b ? b.hint : null,
      common: true,
      default: s.on.includes(b.id),
    })),
  ];
}

const REGISTRY: { id: string; title: string; buttons: ButtonDef[] }[] = SCREENS.map((s) => ({ id: s.id, title: s.title, buttons: screenButtons(s) }));
const DEFAULTS = new Map(REGISTRY.flatMap((s) => s.buttons.map((b) => [b.id, b.default] as const)));

export function isButtonId(id: string): boolean {
  return DEFAULTS.has(id);
}

async function buttonStates(): Promise<Record<string, boolean>> {
  const raw = (await getSettings()).button_states;
  return raw && typeof raw === "object" ? raw : {};
}

/** Ekran uchun tekshiruvchi: `const on = await buttonSwitch("product"); if (on("buy")) ...` */
export async function buttonSwitch(screen: ScreenId): Promise<(button: string) => boolean> {
  const states = await buttonStates();
  return (button) => {
    const id = `${screen}.${button}`;
    return states[id] ?? DEFAULTS.get(id) ?? false;
  };
}

export interface ButtonScreen {
  id: string;
  title: string;
  buttons: { id: string; label: string; hint: string | null; common: boolean; enabled: boolean; default: boolean }[];
}

/** Panel uchun: ekranlar, tugmalar va ularning joriy holati */
export async function listButtons(): Promise<ButtonScreen[]> {
  const states = await buttonStates();
  return REGISTRY.map((s) => ({ ...s, buttons: s.buttons.map((b) => ({ ...b, enabled: states[b.id] ?? b.default })) }));
}

/** Tugmalarni yoqish/o'chirish; haqiqatan o'zgarganlari qaytadi ("home.help: o'chirildi") */
export async function setButtons(values: Record<string, boolean>): Promise<string[]> {
  const states = await buttonStates();
  const next: Record<string, boolean> = {};
  // Ro'yxatdan olib tashlangan eski ID lar va standartga teng holatlar saqlanmaydi
  for (const [id, def] of DEFAULTS) {
    const enabled = values[id] ?? states[id] ?? def;
    if (enabled !== def) next[id] = enabled;
  }
  const changed = [...DEFAULTS].flatMap(([id, def]) => {
    const before = states[id] ?? def;
    const after = next[id] ?? def;
    return before === after ? [] : [`${id}: ${after ? "yoqildi" : "o'chirildi"}`];
  });
  if (changed.length) await setSetting("button_states", next);
  return changed;
}

/** Barcha tugmalarni standart holatga qaytarish */
export async function resetButtons(): Promise<void> {
  await setSetting("button_states", {});
}
