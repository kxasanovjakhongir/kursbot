import { webhookCallback } from "grammy";
import { config } from "./config";
import { logger } from "./lib/logger";
import { prisma } from "./db";
import { createBot } from "./bot/bot";
import { syncEnvSuperAdmins } from "./services/admins";
import { resolveBotToken } from "./services/botToken";
import { syncBotMenu } from "./services/botConfig";
import { resumeBroadcasts } from "./services/broadcast";
import { createApp } from "./api/app";

const ALLOWED_UPDATES = ["message", "callback_query", "chat_join_request", "my_chat_member"] as const;

async function main() {
  await prisma.$connect();
  await syncEnvSuperAdmins();

  const { token, source } = await resolveBotToken();
  const bot = createBot(token);
  await bot.init();
  logger.info({ bot: bot.botInfo.username, mode: config.BOT_MODE, tokenSource: source }, "bot ishga tushmoqda");

  await syncBotMenu(bot.api).catch(() => undefined);

  let webhook: Parameters<typeof createApp>[0]["webhook"];
  if (config.BOT_MODE === "webhook") {
    if (!config.WEBHOOK_URL || !config.WEBHOOK_SECRET) throw new Error("WEBHOOK_URL va WEBHOOK_SECRET kerak");
    // Webhook so'rovlari secret token bilan tekshiriladi (TZ 11.2)
    webhook = {
      path: new URL(config.WEBHOOK_URL).pathname,
      handler: webhookCallback(bot, "express", { secretToken: config.WEBHOOK_SECRET }),
    };
  }

  // Admin panel API + (webhook rejimida) Telegram update lari — bitta HTTP server
  const app = createApp({
    runtime: {
      api: bot.api,
      mode: config.BOT_MODE,
      tokenSource: source,
      isRunning: () => (config.BOT_MODE === "webhook" ? true : bot.isRunning()),
    },
    webhook,
  });
  // Express 5 listen xatosini (masalan, port band) callback'ga beradi
  const server = app.listen(config.PORT, (err?: Error) => {
    if (err) {
      logger.fatal({ err, port: config.PORT }, "HTTP server ishga tushmadi (port band bo'lishi mumkin)");
      process.exit(1);
    }
    logger.info({ port: config.PORT }, "HTTP server (admin API)");
  });

  await resumeBroadcasts(bot.api);

  const stop = async () => {
    if (bot.isRunning()) await bot.stop();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  if (webhook && config.WEBHOOK_URL) {
    await bot.api.setWebhook(config.WEBHOOK_URL, {
      secret_token: config.WEBHOOK_SECRET,
      allowed_updates: [...ALLOWED_UPDATES],
    });
  } else {
    await bot.api.deleteWebhook();
    await bot.start({ allowed_updates: [...ALLOWED_UPDATES] });
  }
}

main().catch((err) => {
  logger.fatal({ err }, "ishga tushmadi");
  process.exit(1);
});
