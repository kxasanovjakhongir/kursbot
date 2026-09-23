import { InlineKeyboard, Keyboard } from "grammy";
import type { Product } from "@prisma/client";
import { config } from "../config";
import { DEFAULT_TEXTS as T } from "../services/texts";

export function mainMenu(): Keyboard {
  return new Keyboard().text(T.menu_products).text(T.menu_purchases).resized().persistent();
}

export function phoneKeyboard(): Keyboard {
  return new Keyboard().requestContact(T.phone_button).resized().oneTime();
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
export function withAskButton(kb: InlineKeyboard): InlineKeyboard {
  const url = supportUrl();
  return url ? kb.url(T.btn_ask, url) : kb;
}

export function productKeyboard(code: string): InlineKeyboard {
  return withAskButton(new InlineKeyboard().text(T.btn_buy, `buy:${code}`));
}

export function contactAdminKeyboard(): InlineKeyboard {
  const url = supportUrl();
  return url ? new InlineKeyboard().url(T.btn_contact_admin, url) : new InlineKeyboard().text(T.btn_contact_admin, "contact");
}

export function reviewKeyboard(orderId: bigint): InlineKeyboard {
  return new InlineKeyboard().text("✅ Tasdiqlash", `adm:ap:${orderId}`).text("❌ Rad etish", `adm:rj:${orderId}`);
}
