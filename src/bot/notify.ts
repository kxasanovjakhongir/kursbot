import { GrammyError, type Api } from "grammy";
import { logger } from "../lib/logger";
import { markBlocked } from "../services/users";
import { getAdminGroupId } from "../services/settings";
import { config } from "../config";

export type SendOptions = Parameters<Api["sendMessage"]>[2];

export function isBlockedError(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 403;
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
    throw err;
  }
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

const lastTechAlert = new Map<string, number>();

/** Texnik chatga xato — bir xil xato 10 daqiqada bir martadan ko'p emas (TZ 7.5) */
export async function alertTech(api: Api, message: string): Promise<void> {
  if (!config.TECH_CHAT_ID) return;
  const key = message.slice(0, 200);
  const now = Date.now();
  if ((lastTechAlert.get(key) ?? 0) > now - 10 * 60_000) return;
  lastTechAlert.set(key, now);
  await api.sendMessage(Number(config.TECH_CHAT_ID), `⚠️ Bot xatosi:\n${message}`.slice(0, 4000)).catch(() => undefined);
}
