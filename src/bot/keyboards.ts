import { InlineKeyboard, Keyboard } from "grammy";
import type { Product } from "@prisma/client";
import { config } from "../config";
import { label, type Lang } from "../i18n";
import { can, type Role } from "../services/permissions";
import { CB } from "./ui/callbacks";

/** Doimiy pastki menyu (reply keyboard). Adminlarga qo'shimcha "Admin panel" tugmasi */
export function mainMenu(lang: Lang, role: Role = "user"): Keyboard {
  const kb = new Keyboard()
    .text(label(lang, "menu_products"))
    .text(label(lang, "menu_purchases"))
    .row()
    .text(label(lang, "menu_profile"))
    .text(label(lang, "menu_settings"))
    .row()
    .text(label(lang, "menu_help"));
  if (can(role, "orders.review")) kb.row().text(label(lang, "menu_admin"));
  return kb.resized().persistent();
}

/** Telefon so'rash. withCancel — profildan raqam yangilashda "Bekor qilish" ham chiqadi */
export function phoneKeyboard(lang: Lang, withCancel = false): Keyboard {
  const kb = new Keyboard().requestContact(label(lang, "phone_button"));
  if (withCancel) kb.row().text(label(lang, "btn_cancel"));
  return kb.resized().oneTime();
}

export function productListKeyboard(products: Product[], prefix = "p"): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const p of products) kb.text(p.title, `${prefix}:${p.code}`).row();
  return kb;
}

function supportUrl(): string | null {
  return config.SUPPORT_USERNAME ? `https://t.me/${config.SUPPORT_USERNAME}` : null;
}

/** 2-bosqichda "Savol berish" bot ichidagi support yozishmaga ulanadi (TZ 7.4) */
export function withAskButton(kb: InlineKeyboard, lang: Lang): InlineKeyboard {
  const url = supportUrl();
  return url ? kb.url(label(lang, "btn_ask"), url) : kb;
}

export function contactAdminKeyboard(lang: Lang): InlineKeyboard {
  const url = supportUrl();
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

/** "📱 Ilovani ochish" — Mini App (WEB_APP_URL berilgan bo'lsa). Inline web_app tugmasi initData ni imzolangan holda beradi */
/** Mini App sahifasi manzili: WEB_APP_URL + yo'l (masalan "product/4b") — ilova shu sahifada ochiladi */
export function webAppUrl(path = ""): string | null {
  if (!config.WEB_APP_URL) return null;
  const base = config.WEB_APP_URL.endsWith("/") ? config.WEB_APP_URL : `${config.WEB_APP_URL}/`;
  return new URL(path, base).toString();
}

export function withWebAppButton(kb: InlineKeyboard, lang: Lang, path = ""): InlineKeyboard {
  const url = webAppUrl(path);
  if (!url) return kb;
  return kb.webApp(label(lang, "btn_open_app"), url).row();
}

export function reviewKeyboard(orderId: bigint): InlineKeyboard {
  return new InlineKeyboard().text("✅ Tasdiqlash", `adm:ap:${orderId}`).text("❌ Rad etish", `adm:rj:${orderId}`);
}
