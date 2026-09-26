import type { NextFunction } from "grammy";
import type { BotContext } from "../context";
import { prisma } from "../../db";
import { getAdmin } from "../../services/admins";
import { roleOf } from "../../services/permissions";
import { touchUser, userLang } from "../../services/users";

/**
 * Kim yozyapti: admin huquqi (har update da Telegram ID bo'yicha qayta tekshiriladi, TZ 11.5),
 * foydalanuvchi yozuvi (shaxsiy chatda yaratiladi yoki yangilanadi), rol va interfeys tili.
 */
export async function identify(ctx: BotContext, next: NextFunction): Promise<void> {
  if (ctx.from && !ctx.from.is_bot) {
    // Admin va foydalanuvchi yozuvlari bir-biriga bog'liq emas — parallel o'qiladi (bitta RTT)
    const [found, touched] = await Promise.all([
      getAdmin(ctx.from.id),
      ctx.chat?.type === "private" ? touchUser(ctx.from) : Promise.resolve(null),
    ]);
    let admin = found;
    if (admin && admin.name !== ctx.from.first_name) {
      admin = await prisma.admin.update({ where: { id: admin.id }, data: { name: ctx.from.first_name } });
    }
    ctx.admin = admin;
    ctx.role = roleOf(admin);
    if (touched) {
      ctx.user = touched.user;
      ctx.isNewUser = touched.isNew;
    }
  }
  ctx.lang = await userLang(ctx.user);
  await next();
}
