import { GrammyError, type Api } from "grammy";
import type { NotificationKind, User } from "@prisma/client";
import { logger } from "../lib/logger";
import { TtlMap } from "../lib/ttlMap";
import { recordNotification } from "../services/notifications";
import { markBlocked } from "../services/users";
import { getAdminGroupId } from "../services/settings";
import { config } from "../config";

export type SendOptions = Parameters<Api["sendMessage"]>[2];

export function isBlockedError(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 403;
}

/** Chat yo'q (foydalanuvchi hisobini o'chirgan yoki bot bilan hech yozishmagan) — qayta urinish befoyda */
function isUnreachableError(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 400 && /chat not found|PEER_ID_INVALID|user not found/i.test(err.description);
}

/** Mijozga xabar: 403 bo'lsa "bloklagan" belgisi qo'yiladi (BR-11). Muvaffaqiyatsiz bo'lsa null. */
export async function sendToUser(
  api: Api,
  telegramId: bigint,
  text: string,
  other?: SendOptions,
) {
  try {
    return await api.sendMessage(Number(telegramId), text, { parse_mode: "HTML", ...other });
  } catch (err) {
    if (isBlockedError(err)) {
      await markBlocked(telegramId);
      logger.info({ telegramId: telegramId.toString() }, "foydalanuvchi botni bloklagan");
      return null;
    }
    if (isUnreachableError(err)) {
      logger.warn({ telegramId: telegramId.toString(), description: (err as GrammyError).description }, "foydalanuvchiga xabar yetkazib bo'lmaydi");
      return null;
    }
    throw err;
  }
}

/**
 * Bildirishnoma: foydalanuvchiga yuboriladi va tarixga yoziladi (profil → "Bildirishnomalar").
 * Yetkazilmasa ham (bloklagan) yozuv qoladi — admin panelda ko'rinadi.
 */
export async function notifyUser(
  api: Api,
  user: Pick<User, "id" | "telegramId">,
  kind: NotificationKind,
  text: string,
  other?: SendOptions,
) {
  const sent = await sendToUser(api, user.telegramId, text, other);
  await recordNotification(user.id, kind, text, !!sent);
  return sent;
}

export async function sendToAdminGroup(
  api: Api,
  text: string,
  other?: SendOptions,
) {
  const groupId = await getAdminGroupId();
  if (!groupId) {
    logger.warn("ADMIN_GROUP_ID sozlanmagan — admin xabari yuborilmadi");
    return null;
  }
  return api.sendMessage(Number(groupId), text, { parse_mode: "HTML", ...other });
}

const lastTechAlert = new TtlMap<string, true>(10 * 60_000, 1000);

/** Texnik chatga xato — bir xil xato 10 daqiqada bir martadan ko'p emas (TZ 7.5) */
export async function alertTech(api: Api, message: string): Promise<void> {
  if (!config.TECH_CHAT_ID) return;
  const key = message.slice(0, 200);
  if (lastTechAlert.has(key)) return;
  lastTechAlert.set(key, true);
  await api.sendMessage(Number(config.TECH_CHAT_ID), `⚠️ Bot xatosi:\n${message}`.slice(0, 4000)).catch(() => undefined);
}
