import { InlineKeyboard, Keyboard } from "grammy";
import type { Product } from "@prisma/client";
import { label, type Lang } from "../i18n";
import { can, type Role } from "../services/permissions";
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

/*
 * Support tugmalari — to'g'ridan-to'g'ri t.me profiliga URL. Username paneldan o'zgartirilsa, avval
 * yuborilgan xabarlardagi tugmalar ham fonda yangilanadi (services/supportButtons.ts).
 */

/** "💬 Yordam" — bir bosishda support profiliga; sozlanmagan bo'lsa yordam ekraniga */
export async function withHelpButton(kb: InlineKeyboard, lang: Lang): Promise<InlineKeyboard> {
  const url = await getSupportUrl();
  const text = label(lang, "menu_help");
  return url ? kb.url(text, url) : kb.text(text, CB.help);
}

export async function contactAdminKeyboard(lang: Lang): Promise<InlineKeyboard> {
  const url = await getSupportUrl();
  const text = label(lang, "btn_contact_admin");
  return url ? new InlineKeyboard().url(text, url) : new InlineKeyboard().text(text, CB.contact);
}

/**
 * Pastki navigatsiya qatori: "⬅️ Orqaga" (agar oldingi ekran bosh menyu bo'lmasa) va "🏠 Bosh menyu".
 * Foydalanuvchi har bir ichki ekrandan bir bosishda chiqib keta oladi.
 */
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
