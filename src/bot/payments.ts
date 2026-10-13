import type { Api } from "grammy";
import type { PaymentMethod } from "@prisma/client";
import { prisma } from "../db";
import { escapeHtml, formatSum } from "../lib/format";
import { logger } from "../lib/logger";
import { KickFailedError, revokeGrant } from "../services/membership";
import { trackEvent } from "../services/events";
import { displayCourseName } from "../services/settings";
import { displayName, userLang } from "../services/users";
import { translate } from "../i18n";
import { contactAdminKeyboard } from "./keyboards";
import { notifyUser, sendToAdminGroup } from "./notify";
import { deliverApproved, syncCards } from "./admin/reviewActions";

/**
 * Onlayn to'lov (Payme / Click) natijalari bo'yicha bot amallari. To'lov tizimiga javob qaytgandan keyin
 * fon rejimida bajariladi — Telegram sekin javob bersa ham to'lov tizimi kutib qolmaydi.
 */

const PROVIDER_NAME: Record<PaymentMethod, string> = { payme: "Payme", click: "Click", card: "Karta" };

/** To'lov tushdi: kirish beriladi, mijozga xabar, admin guruhiga ma'lumot */
export async function onOnlinePaid(api: Api, orderId: bigint, provider: PaymentMethod, duplicate: boolean): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { user: true, product: true } });
  if (!order) return;
  const who = `${escapeHtml(displayName(order.user))}${order.user.phone ? `, ${escapeHtml(order.user.phone)}` : ""}`;

  if (duplicate) {
    // Buyurtma allaqachon to'langan edi (masalan, karta cheki tasdiqlangan) — pul qayta yechildi
    await sendToAdminGroup(
      api,
      `⚠️ <b>Buyurtma #${orderId}</b>: ${PROVIDER_NAME[provider]} orqali ${formatSum(order.amount)} to'landi, lekin buyurtma allaqachon to'langan edi. ` +
        `Mijoz (${who}) ga pulni ${PROVIDER_NAME[provider]} kabinetidan qaytaring.`,
    ).catch(() => undefined);
    return;
  }

  // Chek ham yuborilgan bo'lsa — guruhdagi kartochkadan tasdiqlash tugmalari olinadi
  await syncCards(api, orderId);
  await deliverApproved(api, orderId);
  await sendToAdminGroup(
    api,
    `💳 <b>Buyurtma #${orderId}</b> ${PROVIDER_NAME[provider]} orqali to'landi: ${formatSum(order.amount)}\n` +
      `📚 ${escapeHtml(await displayCourseName(order.product.title))}\n👤 ${who}`,
  ).catch(() => undefined);
}

/** To'lov tizimi to'langan tranzaksiyani bekor qildi (pul mijozga qaytdi): kirish yopiladi, buyurtma refunded */
export async function onOnlineRefund(api: Api, orderId: bigint, provider: PaymentMethod): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, product: true, grants: { where: { revokedAt: null }, include: { product: true, user: true } } },
  });
  if (!order) return;

  const failed: string[] = [];
  for (const grant of order.grants) {
    try {
      await revokeGrant(api, grant, "removed", { notify: false });
    } catch (err) {
      // Pul baribir qaytarilgan — buyurtma yopiladi, kanaldan chiqarishni admin qo'lda bajaradi
      if (err instanceof KickFailedError) failed.push(err.productTitle);
      else logger.error({ err, orderId: orderId.toString() }, "qaytarishda kirish yopilmadi");
    }
  }

  const reason = `${PROVIDER_NAME[provider]}: to'lov bekor qilindi (pul qaytarildi)`;
  const res = await prisma.order.updateMany({
    where: { id: orderId, status: { in: ["approved", "joined"] } },
    data: { status: "refunded", cancelledAt: new Date(), cancelReason: reason },
  });
  await trackEvent(order.userId, "order_refunded", { orderId: orderId.toString(), provider });

  if (res.count === 1 && !order.user.isBanned) {
    const lang = await userLang(order.user);
    const text = await translate(
      lang,
      "order_refunded_online",
      { raqam: orderId.toString(), mahsulot: await displayCourseName(order.product.title) },
    );
    await notifyUser(api, order.user, "order", text, { reply_markup: await contactAdminKeyboard(lang) }).catch((err) =>
      logger.warn({ err, orderId: orderId.toString() }, "qaytarish xabari yuborilmadi"),
    );
  }
  await sendToAdminGroup(
    api,
    `↩️ <b>Buyurtma #${orderId}</b>: ${PROVIDER_NAME[provider]} to'lovni bekor qildi, pul mijozga qaytarildi. Kirish yopildi.` +
      (failed.length ? `\n⚠️ Kanaldan chiqarib bo'lmadi: ${escapeHtml(failed.join(", "))} — qo'lda chiqaring.` : ""),
  ).catch(() => undefined);
}

/** Fon vazifasi: xato to'lov tizimi javobiga ta'sir qilmaydi, faqat logga yoziladi */
export function runInBackground(label: string, task: () => Promise<void>): void {
  task().catch((err) => logger.error({ err }, label));
}
