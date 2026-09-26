import { GrammyError, type Api } from "grammy";
import type { GrantRevokeReason, User } from "@prisma/client";
import { prisma } from "../db";
import { notifyUser } from "../bot/notify";
import { translate, type TextKey } from "../i18n";
import { formatDate } from "../lib/format";
import { logger } from "../lib/logger";
import { setBanned, userLang } from "./users";
import type { GrantWithProduct } from "./access";

/**
 * Yopiq kanal a'zoligini boshqarish: admin chiqarishi, cheklash, kirish muddati va uning tugashi.
 *
 * "Chiqarish" = ban + darhol unban: foydalanuvchi kanaldan chiqadi, lekin keyin yangi (to'langan)
 * link bilan qaytib kira oladi. Kanalga qaytishning o'zi faqat faol AccessGrant bilan mumkin
 * (decideJoinRequest), shuning uchun kanalda doimiy ban shart emas.
 */

export type KickResult = "ok" | "retry";

/** Bot huquqi yetmasa yoki limit — keyin qayta urinish kerak */
const RETRY_DESCRIPTION = /not enough rights|need administrator|CHAT_ADMIN_REQUIRED|have no rights|Too Many Requests/i;

export async function kickFromChannel(api: Api, channelId: bigint, telegramId: bigint): Promise<KickResult> {
  const chat = Number(channelId);
  const user = Number(telegramId);
  try {
    await api.banChatMember(chat, user);
    await api.unbanChatMember(chat, user, { only_if_banned: true });
    return "ok";
  } catch (err) {
    // Telegram aniq rad etgan (masalan, foydalanuvchi kanalda emas yoki kanal o'chirilgan) — chiqarishga hojat yo'q
    if (err instanceof GrammyError && !RETRY_DESCRIPTION.test(err.description)) {
      logger.info({ chat, user, description: err.description }, "kanaldan chiqarish: o'tkazib yuborildi");
      return "ok";
    }
    // Bot huquqi yo'q, tarmoq yoki boshqa xato — kirish saqlanadi, keyin qayta uriniladi
    logger.warn({ err, chat, user }, "kanaldan chiqarib bo'lmadi — keyin qayta uriniladi");
    return "retry";
  }
}

export class KickFailedError extends Error {
  constructor(readonly productTitle: string) {
    super(`Bot «${productTitle}» kanalida admin emas yoki «a'zolarni bloklash» huquqi yo'q — foydalanuvchini chiqarib bo'lmadi`);
  }
}

type GrantFull = GrantWithProduct & { user: User };

async function loadGrant(grantId: bigint): Promise<GrantFull | null> {
  return prisma.accessGrant.findUnique({ where: { id: grantId }, include: { product: true, user: true } });
}

async function notify(api: Api, user: User, key: TextKey, vars: Record<string, string>, kind: "warning" | "success") {
  if (user.isBanned) return; // cheklangan foydalanuvchiga bot yozmaydi
  const text = await translate(await userLang(user), key, vars);
  await notifyUser(api, user, kind, text).catch((err) => logger.warn({ err }, "a'zolik bildirishnomasi yuborilmadi"));
}

/**
 * Kirishni bekor qiladi: kanaldan chiqaradi, shaxsiy linkni o'chiradi va bazada belgilaydi.
 * Chiqarib bo'lmasa (bot huquqi yo'q) — baza o'zgarmaydi va KickFailedError tashlanadi.
 */
export async function revokeGrant(api: Api, grant: GrantFull, reason: GrantRevokeReason, opts: { notify: boolean }): Promise<void> {
  const { product, user } = grant;
  if (product.channelId) {
    if ((await kickFromChannel(api, product.channelId, user.telegramId)) === "retry") throw new KickFailedError(product.title);
    if (grant.inviteLink) await api.revokeChatInviteLink(Number(product.channelId), grant.inviteLink).catch(() => undefined);
  }
  await prisma.accessGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date(), revokeReason: reason } });
  if (opts.notify) {
    await notify(api, user, reason === "expired" ? "access_expired" : "access_removed", { mahsulot: product.title }, "warning");
  }
}

export async function revokeGrantById(api: Api, grantId: bigint, reason: GrantRevokeReason): Promise<GrantFull | null> {
  const grant = await loadGrant(grantId);
  if (!grant || grant.revokedAt) return grant;
  await revokeGrant(api, grant, reason, { notify: true });
  return grant;
}

/**
 * Kirish muddatini o'rnatadi (null — muddatsiz). Bekor qilingan kirish bo'lsa — tiklanadi:
 * foydalanuvchi yangi linkni "Mening xaridlarim" dan oladi.
 */
export async function setGrantExpiry(api: Api, grantId: bigint, expiresAt: Date | null): Promise<GrantFull | null> {
  const grant = await loadGrant(grantId);
  if (!grant) return null;
  const restoring = !!grant.revokedAt;
  const updated = await prisma.accessGrant.update({
    where: { id: grant.id },
    data: {
      expiresAt,
      expiryRemindedAt: null,
      ...(restoring ? { revokedAt: null, revokeReason: null, joinedAt: null, inviteLink: null, linkExpiresAt: null } : {}),
    },
    include: { product: true, user: true },
  });
  const vars = { mahsulot: grant.product.title, sana: expiresAt ? formatDate(expiresAt) : "" };
  await notify(api, grant.user, restoring ? "access_restored" : expiresAt ? "access_extended" : "access_unlimited", vars, "success");
  return updated;
}

/** Cheklashda: barcha faol kanallardan chiqarish. Chiqarib bo'lmaganlar nomi qaytariladi */
export async function revokeUserGrants(api: Api, userId: bigint, reason: GrantRevokeReason): Promise<{ removed: number; failed: string[] }> {
  const grants = await prisma.accessGrant.findMany({ where: { userId, revokedAt: null }, include: { product: true, user: true } });
  let removed = 0;
  const failed: string[] = [];
  for (const g of grants) {
    try {
      await revokeGrant(api, g, reason, { notify: false });
      removed++;
    } catch (err) {
      if (!(err instanceof KickFailedError)) throw err;
      failed.push(g.product.title);
    }
  }
  return { removed, failed };
}

/** Cheklov olib tashlanganda — cheklov sababli yopilgan (va muddati o'tmagan) kirishlar tiklanadi */
export async function restoreBannedGrants(userId: bigint): Promise<number> {
  const { count } = await prisma.accessGrant.updateMany({
    where: { userId, revokeReason: "banned", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    data: { revokedAt: null, revokeReason: null, joinedAt: null, inviteLink: null, linkExpiresAt: null },
  });
  return count;
}

/** Cheklash (bot javob bermaydi) va ixtiyoriy ravishda barcha yopiq kanallardan chiqarish */
export async function banUser(api: Api, userId: bigint, removeFromChannels: boolean) {
  const user = await setBanned(userId, true);
  const channels = removeFromChannels ? await revokeUserGrants(api, userId, "banned") : { removed: 0, failed: [] };
  return { user, channels };
}

/** Cheklovni olib tashlash: cheklov sababli yopilgan kanal kirishlari ham tiklanadi */
export async function unbanUser(userId: bigint) {
  const user = await setBanned(userId, false);
  return { user, restored: await restoreBannedGrants(userId) };
}

// ---------- Avtomatik vazifalar ----------

const BATCH = 100;
const REMIND_BEFORE_MS = 3 * 86400_000;

/** Bir ishga tushishda ko'rib chiqiladigan eng ko'p yozuv (qolgani keyingi safar) */
const MAX_PER_RUN = 1000;

/**
 * Muddati o'tgan kirishlar: kanaldan chiqariladi. Bot huquqi yo'q bo'lsa — keyingi safar qayta uriniladi.
 * Kursor (id) bilan yuriladi: chiqarib bo'lmaganlar (masalan, bitta kanalda bot huquqini yo'qotgan)
 * navbatning boshida qolib, boshqa kanallardagi muddati o'tganlarni to'sib qo'ymaydi.
 */
export async function processExpiredGrants(api: Api): Promise<{ removed: number; pending: number }> {
  let removed = 0;
  let pending = 0;
  let cursor: bigint | undefined;
  for (let seen = 0; seen < MAX_PER_RUN; ) {
    const grants = await prisma.accessGrant.findMany({
      where: { revokedAt: null, expiresAt: { lte: new Date() }, ...(cursor ? { id: { gt: cursor } } : {}) },
      include: { product: true, user: true },
      orderBy: { id: "asc" },
      take: BATCH,
    });
    if (grants.length === 0) break;
    for (const g of grants) {
      try {
        await revokeGrant(api, g, "expired", { notify: true });
        removed++;
      } catch (err) {
        if (!(err instanceof KickFailedError)) throw err;
        pending++;
      }
    }
    seen += grants.length;
    cursor = grants[grants.length - 1].id;
    if (grants.length < BATCH) break;
  }
  return { removed, pending };
}

/** Muddat tugashiga 3 kun qolganda bir marta eslatma */
export async function remindExpiringGrants(api: Api): Promise<number> {
  const now = Date.now();
  const grants = await prisma.accessGrant.findMany({
    where: { revokedAt: null, expiryRemindedAt: null, expiresAt: { gt: new Date(now), lte: new Date(now + REMIND_BEFORE_MS) } },
    include: { product: true, user: true },
    take: BATCH,
  });
  for (const g of grants) {
    // Avval belgilanadi — xato bo'lsa ham eslatma takrorlanmaydi
    await prisma.accessGrant.update({ where: { id: g.id }, data: { expiryRemindedAt: new Date() } });
    await notify(api, g.user, "access_expiring", { mahsulot: g.product.title, sana: formatDate(g.expiresAt!) }, "warning");
  }
  return grants.length;
}

/** Fon vazifasi (services/jobs.ts chaqiradi): muddati o'tganlarni chiqarish va eslatmalar */
export async function runAccessChecks(api: Api): Promise<void> {
  const expired = await processExpiredGrants(api);
  const reminded = await remindExpiringGrants(api);
  if (expired.removed || expired.pending || reminded) logger.info({ ...expired, reminded }, "kirish muddatlari tekshirildi");
}
