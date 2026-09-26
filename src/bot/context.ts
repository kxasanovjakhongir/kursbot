import { Context } from "grammy";
import type { Admin, User } from "@prisma/client";
import type { Logger } from "pino";
import { DEFAULT_LANG, label, translate, type Lang, type TextKey, type Vars } from "../i18n";
import { logger } from "../lib/logger";
import type { Role } from "../services/permissions";

/**
 * Bot konteksti. Qiymatlar `identify` middleware da har bir update uchun qayta aniqlanadi;
 * bu yerdagilar — middleware ishlamay qolgan holat uchun xavfsiz standartlar.
 */
export class BotContext extends Context {
  /** Shaxsiy chatdagi foydalanuvchi yozuvi */
  user: User | null = null;
  /** Admin bo'lsa — uning yozuvi (har bir update da ID bo'yicha qayta tekshiriladi) */
  admin: Admin | null = null;
  role: Role = "user";
  lang: Lang = DEFAULT_LANG;
  /** Shu update da bazaga birinchi marta yozildi */
  isNewUser = false;
  /** Update konteksti (user, chat, action) bilan boyitilgan logger */
  log: Logger = logger;
  /** Handler xatosi turi (errorBoundary belgilaydi) — metrika va log uchun */
  failure: string | null = null;

  /** Joriy foydalanuvchi tilidagi matn (bazadagi override bilan) */
  t(key: TextKey, vars?: Vars, raw?: Record<string, string>): Promise<string> {
    return translate(this.lang, key, vars, raw);
  }

  /** Tugma yozuvi (sinxron) */
  label(key: TextKey, vars?: Vars): string {
    return label(this.lang, key, vars);
  }
}
