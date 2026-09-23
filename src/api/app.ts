import "./types";
import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express, type RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "../config";
import { requireAuth, requireSuperAdmin } from "./auth";
import { errorHandler, notFound } from "./errors";
import type { BotRuntime } from "./runtime";
import { authRouter } from "./routes/auth";
import { dashboardRouter } from "./routes/dashboard";
import { botRouter } from "./routes/bot";
import { commandsRouter } from "./routes/commands";
import { menuRouter } from "./routes/menu";
import { telegramUsersRouter } from "./routes/telegramUsers";
import { messagesRouter } from "./routes/messages";
import { broadcastRouter } from "./routes/broadcast";
import { adminsRouter } from "./routes/admins";
import { activityRouter } from "./routes/activity";
import { ordersRouter } from "./routes/orders";
import { productsRouter } from "./routes/products";
import { cardsRouter } from "./routes/cards";

export interface AppOptions {
  runtime: BotRuntime;
  /** Webhook rejimida Telegram update lari shu yo'lga keladi */
  webhook?: { path: string; handler: RequestHandler };
}

export function createApp({ runtime, webhook }: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  // BigInt (Telegram ID, buyurtma raqami) JSON da satr sifatida
  app.set("json replacer", (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value));

  if (webhook) app.post(webhook.path, express.json({ limit: "10mb" }), webhook.handler);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Chek rasmlari va broadcast preview blob: URL orqali ko'rsatiladi
          "img-src": ["'self'", "data:", "blob:"],
          "media-src": ["'self'", "blob:"],
        },
      },
    }),
  );
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  const api = express.Router();
  api.use(
    cors({
      origin: config.CLIENT_URL.split(",").map((s) => s.trim()),
      credentials: false,
    }),
  );
  api.use(express.json({ limit: "1mb" }));
  api.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false }));

  api.use("/auth", authRouter);

  // Quyidagilarning barchasi JWT talab qiladi
  api.use(requireAuth);
  api.use("/dashboard", dashboardRouter);
  api.use("/bot/commands", commandsRouter);
  api.use("/bot/menu", menuRouter(runtime));
  api.use("/bot", botRouter(runtime));
  api.use("/telegram-users", telegramUsersRouter);
  api.use("/messages", messagesRouter);
  api.use("/broadcast", broadcastRouter(runtime));
  api.use("/orders", ordersRouter(runtime));
  // Narx, video, kanal va kartalar — faqat SUPER_ADMIN (TZ 2.2)
  api.use("/products", requireSuperAdmin, productsRouter(runtime));
  api.use("/cards", requireSuperAdmin, cardsRouter);
  api.use("/admins", requireSuperAdmin, adminsRouter);
  api.use("/activity-logs", requireSuperAdmin, activityRouter);
  api.use(notFound);

  app.use("/api", api);

  // Production: admin panel (admin/dist) shu serverning o'zidan beriladi
  const dist = path.resolve(__dirname, "../../admin/dist");
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
