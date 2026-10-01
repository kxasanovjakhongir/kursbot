import type { Server } from "node:http";
import { webhookCallback } from "grammy";
import { run, type RunnerHandle } from "@grammyjs/runner";
import { config } from "./config";
import { logger } from "./lib/logger";
import { prisma } from "./db";
import { createBot } from "./bot/bot";
import { setRetryDatabaseErrors } from "./bot/middleware/errorBoundary";
import { syncEnvSuperAdmins } from "./services/admins";
import { resolveBotToken } from "./services/botToken";
import { resetMenuButton, syncBotMenu } from "./services/botConfig";
import { startBackgroundJobs } from "./services/jobs";
import { createApp } from "./api/app";
import { lifecycle } from "./lib/lifecycle";
import { flushErrorLogs } from "./lib/errorSink";

const ALLOWED_UPDATES = ["message", "callback_query", "chat_join_request", "my_chat_member"] as const;

async function main() {
  await prisma.$connect();
  await syncEnvSuperAdmins();

  const { token, source } = await resolveBotToken();
  const bot = createBot(token);
  await bot.init();
  logger.info(
    { bot: bot.botInfo.username, mode: config.BOT_MODE, tokenSource: source, concurrency: config.BOT_CONCURRENCY },
    "bot ishga tushmoqda",
  );

  await syncBotMenu(bot.api).catch(() => undefined);
  // Avvalgi versiyadagi Mini App "Menu" tugmasi chatlardan olib tashlanadi
  await resetMenuButton(bot.api);

  let webhook: Parameters<typeof createApp>[0]["webhook"];
  if (config.BOT_MODE === "webhook") {
    if (!config.WEBHOOK_URL || !config.WEBHOOK_SECRET) throw new Error("WEBHOOK_URL va WEBHOOK_SECRET kerak");
    // Baza vaqtincha ishlamasa — xato qaytariladi va Telegram update ni keyinroq qayta yuboradi (yo'qolmaydi)
    setRetryDatabaseErrors(true);
    // Webhook so'rovlari secret token bilan tekshiriladi (TZ 11.2).
    // Uzoq handler: Telegram'ga 200 qaytariladi, qayta ishlash davom etadi — aks holda Telegram
    // update ni qayta yuboradi va amal ikki marta bajarilishi mumkin
    webhook = {
      path: new URL(config.WEBHOOK_URL).pathname,
      handler: webhookCallback(bot, "express", { secretToken: config.WEBHOOK_SECRET, onTimeout: "return", timeoutMilliseconds: 9_000 }),
    };
  }

  let runner: RunnerHandle | null = null;
  // Admin panel API + (webhook rejimida) Telegram update lari — bitta HTTP server
  const app = createApp({
    runtime: {
      api: bot.api,
      mode: config.BOT_MODE,
      tokenSource: source,
      isRunning: () => (config.BOT_MODE === "webhook" ? true : (runner?.isRunning() ?? false)),
    },
    webhook,
  });
  const server: Server = await new Promise((resolve) => {
    // Express 5 listen xatosini (masalan, port band) callback'ga beradi
    const s = app.listen(config.PORT, (err?: Error) => {
      if (err) {
        logger.fatal({ err, port: config.PORT }, "HTTP server ishga tushmadi (port band bo'lishi mumkin)");
        process.exit(1);
      }
      logger.info({ port: config.PORT }, "HTTP server (admin API)");
      resolve(s);
    });
  });
  // Load balancer ulanishni server yopgandan keyin ishlatmasligi uchun keep-alive LB dan uzunroq
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  const stopJobs = startBackgroundJobs(bot.api);

  if (webhook && config.WEBHOOK_URL) {
    await bot.api.setWebhook(config.WEBHOOK_URL, {
      secret_token: config.WEBHOOK_SECRET,
      allowed_updates: [...ALLOWED_UPDATES],
      max_connections: config.WEBHOOK_MAX_CONNECTIONS,
    });
  } else {
    await bot.api.deleteWebhook();
    // Parallel polling: bir vaqtda BOT_CONCURRENCY tagacha update, bitta chat ichida tartib saqlanadi
    runner = run(bot, {
      runner: { fetch: { allowed_updates: [...ALLOWED_UPDATES] } },
      sink: { concurrency: config.BOT_CONCURRENCY },
    });
  }
  lifecycle.markReady();

  lifecycle.onShutdown(async () => {
    // 1) yangi ish qabul qilinmaydi (/ready → 503), 2) joriy update lar tugaydi,
    // 3) fon vazifalari to'xtaydi, 4) HTTP yopiladi, 5) baza ulanishlari yopiladi
    if (runner?.isRunning()) await runner.stop();
    await stopJobs();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Yig'ilgan texnik xatolar (panel: "Xatoliklar") baza yopilishidan oldin yoziladi
    await flushErrorLogs();
    await prisma.$disconnect();
  });
}

lifecycle.installProcessHandlers();
main().catch(async (err) => {
  logger.fatal({ err }, "ishga tushmadi");
  // Baza ishlayotgan bo'lsa, xato panelda ham ko'rinsin (masalan, port band)
  await Promise.race([flushErrorLogs(), new Promise((r) => setTimeout(r, 3000))]);
  process.exit(1);
});
