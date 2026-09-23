import { createServer } from "node:http";
import { webhookCallback } from "grammy";
import { config } from "./config";
import { logger } from "./lib/logger";
import { prisma } from "./db";
import { createBot } from "./bot/bot";
import { syncEnvSuperAdmins } from "./services/admins";

const ALLOWED_UPDATES = ["message", "callback_query", "chat_join_request", "my_chat_member"] as const;

async function main() {
  await prisma.$connect();
  await syncEnvSuperAdmins();
  const bot = createBot();
  await bot.init();
  logger.info({ bot: bot.botInfo.username, mode: config.BOT_MODE }, "bot ishga tushmoqda");

  await bot.api.setMyCommands([
    { command: "start", description: "Boshlash" },
    { command: "purchases", description: "Mening xaridlarim" },
  ]);

  if (config.BOT_MODE === "webhook") {
    if (!config.WEBHOOK_URL || !config.WEBHOOK_SECRET) throw new Error("WEBHOOK_URL va WEBHOOK_SECRET kerak");
    // Webhook so'rovlari secret token bilan tekshiriladi (TZ 11.2)
    const handle = webhookCallback(bot, "http", { secretToken: config.WEBHOOK_SECRET });
    const path = new URL(config.WEBHOOK_URL).pathname;
    const server = createServer((req, res) => {
      if (req.method === "POST" && req.url === path) return void handle(req, res);
      if (req.url === "/health") return void res.writeHead(200).end("ok");
      res.writeHead(404).end();
    });
    server.listen(config.PORT, () => logger.info({ port: config.PORT }, "webhook server"));
    await bot.api.setWebhook(config.WEBHOOK_URL, {
      secret_token: config.WEBHOOK_SECRET,
      allowed_updates: [...ALLOWED_UPDATES],
    });
    const stop = () => server.close(() => prisma.$disconnect().finally(() => process.exit(0)));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } else {
    await bot.api.deleteWebhook();
    const stop = async () => {
      await bot.stop();
      await prisma.$disconnect();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    await bot.start({ allowed_updates: [...ALLOWED_UPDATES] });
  }
}

main().catch((err) => {
  logger.fatal({ err }, "ishga tushmadi");
  process.exit(1);
});
