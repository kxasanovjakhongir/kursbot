import { config } from "../config";
import { decrypt, encrypt } from "../lib/crypto";
import { logger } from "../lib/logger";
import { getSettings, setSetting } from "./settings";

/** Admin paneldan yangilangan token bazada shifrlangan holda turadi va .env dagidan ustun */
export async function resolveBotToken(): Promise<{ token: string; source: "env" | "database" }> {
  const s = await getSettings();
  if (s.bot_token_enc) {
    try {
      return { token: decrypt(s.bot_token_enc), source: "database" };
    } catch (err) {
      logger.error({ err }, "bazadagi tokenni ochib bo'lmadi — .env dagi token ishlatiladi");
    }
  }
  return { token: config.BOT_TOKEN, source: "env" };
}

export async function saveBotToken(token: string): Promise<void> {
  await setSetting("bot_token_enc", encrypt(token));
}
