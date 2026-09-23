import type { Context } from "grammy";
import type { Admin, User } from "@prisma/client";

export interface CustomFlavor {
  /** Shaxsiy chatdagi foydalanuvchi yozuvi */
  user: User | null;
  /** Admin bo'lsa — uning yozuvi (har bir update da ID bo'yicha qayta tekshiriladi) */
  admin: Admin | null;
}

export type BotContext = Context & CustomFlavor;
