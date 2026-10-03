import { InlineKeyboard, Keyboard } from "grammy";
import type { Product } from "@prisma/client";
import { label, type Lang } from "../i18n";
import { can, type Role } from "../services/permissions";
import type { InlineKeyboardButton } from "grammy/types";
import { buttonSwitch, COMMON_BUTTONS, type CommonButton, type ScreenId } from "../services/buttons";
import { getSupportUrl } from "../services/settings";
import { CB } from "./ui/callbacks";

/**
 * Doimiy pastki menyu (reply keyboard): "Darsliklar" va "Yordam". "Admin panel" faqat adminlarga.
 * Sotib olingan kurs (darslar, kanal havolasi) «Darsliklar» ichida ochiladi. Profil va sozlamalar —
 * /profile, /settings buyruqlari orqali.
 */
export function mainMenu(lang: Lang, role: Role = "user"): Keyboard {
  const kb = new Keyboard().text(label(lang, "menu_products")).text(label(lang, "menu_help"));
  if (can(role, "orders.review")) kb.row().text(label(lang, "menu_admin"));
  return kb.resized().persistent();
}

/** Telefon so'rash. withCancel — profildan raqam yangilashda "Bekor qilish" ham chiqadi */
export function phoneKeyboard(lang: Lang, withCancel = false): Keyboard {
  const kb = new Keyboard().requestContact(label(lang, "phone_button"));
  if (withCancel) kb.row().text(label(lang, "btn_cancel"));
  return kb.resized().oneTime();
}

/** name — kurs nomi formatlovchisi (courseNameFormatter) */
export function productListKeyboard(products: Product[], name: (title: string) => string, prefix = "p"): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const p of products) kb.text(name(p.title), `${prefix}:${p.code}`).row();
  return kb;
}

/**
 * Ekran ostidagi tugmalar: paneldan («Bot tugmalari») yoqilgan umumiy tugmalar (ikki ustunda), keyin
 * navigatsiya qatori — "⬅️ Orqaga" (oldingi ekran bosh menyu bo'lmasa) va "🏠 Bosh menyu".
 *
 * Support tugmalari — to'g'ridan-to'g'ri t.me profiliga URL. Username paneldan o'zgartirilsa, avval
 * yuborilgan xabarlardagi tugmalar ham fonda yangilanadi (services/supportButtons.ts).
 */
export async function withScreenButtons(kb: InlineKeyboard, lang: Lang, screen: ScreenId, back?: string): Promise<InlineKeyboard> {
  const [on, url] = await Promise.all([buttonSwitch(screen), getSupportUrl()]);
  const support = (text: string, fallback: string | null): InlineKeyboardButton | null =>
    url ? { text, url } : fallback ? { text, callback_data: fallback } : null;
  const build: Record<Exclude<CommonButton, "home">, () => InlineKeyboardButton | null> = {
    products: () => ({ text: label(lang, "menu_products"), callback_data: CB.catalog() }),
    // Sozlanmagan bo'lsa: "Yordam" — yordam ekraniga, "Savol berish" — chiqmaydi
    help: () => support(label(lang, "menu_help"), CB.help),
    ask: () => support(label(lang, "btn_ask"), null),
    contact: () => support(label(lang, "btn_contact_admin"), screen === "help" ? null : CB.contact),
    profile: () => ({ text: label(lang, "menu_profile"), callback_data: CB.profile }),
    settings: () => ({ text: label(lang, "menu_settings"), callback_data: CB.settings }),
  };
  const extras = COMMON_BUTTONS.flatMap((b) => (b.id !== "home" && on(b.id) ? (build[b.id]() ?? []) : []));
  for (let i = 0; i < extras.length; i += 2) kb.row(...extras.slice(i, i + 2));
  kb.row();
  if (back && back !== CB.home && on("back")) kb.text(label(lang, "btn_back"), back);
  if (on("home")) kb.text(label(lang, "btn_home"), CB.home);
  // Tugmasi qolmagan qatorlar Telegram'ga yuborilmaydi
  return new InlineKeyboard(kb.inline_keyboard.filter((row) => row.length > 0));
}

/** Xatolik/bildirishnoma xabarlari ostidagi tugmalar ("Admin bilan bog'lanish"); hammasi o'chirilgan bo'lsa undefined */
export async function contactAdminKeyboard(lang: Lang): Promise<InlineKeyboard | undefined> {
  const kb = await withScreenButtons(new InlineKeyboard(), lang, "notices");
  return kb.inline_keyboard.length ? kb : undefined;
}

/** Admin ekranlari navigatsiyasi: "⬅️ Orqaga" va "🏠 Bosh menyu" (paneldan o'chirilmaydi) */
export function withNav(kb: InlineKeyboard, lang: Lang, back?: string): InlineKeyboard {
  kb.row();
  if (back && back !== CB.home) kb.text(label(lang, "btn_back"), back);
  return kb.text(label(lang, "btn_home"), CB.home);
}

/** "◀️  2 / 5  ▶️" — faqat bir sahifadan ko'p bo'lsa */
export function withPagination(kb: InlineKeyboard, page: number, pages: number, cb: (page: number) => string): InlineKeyboard {
  if (pages <= 1) return kb;
  kb.row();
  kb.text(page > 1 ? "◀️" : " ", page > 1 ? cb(page - 1) : CB.noop);
  kb.text(`${page} / ${pages}`, CB.noop);
  kb.text(page < pages ? "▶️" : " ", page < pages ? cb(page + 1) : CB.noop);
  return kb;
}

export function reviewKeyboard(orderId: bigint): InlineKeyboard {
  return new InlineKeyboard().text("✅ Tasdiqlash", `adm:ap:${orderId}`).text("❌ Rad etish", `adm:rj:${orderId}`);
}
