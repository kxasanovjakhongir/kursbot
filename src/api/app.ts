import "./types";
import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express, type RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "../config";
import { requireAuth, requirePermission } from "./auth";
import { errorHandler, notFound } from "./errors";
import { mountProbes, requestObserver } from "./observability";
import { mountTrackingRedirect } from "./trackingRedirect";
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
import { linksRouter } from "./routes/links";
import { analyticsRouter } from "./routes/analytics";
import { webAppRouter } from "./webapp/router";
import { errorsRouter } from "./routes/errors";
import { lessonsRouter } from "./routes/lessons";

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
  app.use(requestObserver); // request ID, metrikalar, tuzilgan log

  // Telegram update lari kichik (odatda < 10 KB); 1 MB — katta zaxira, lekin xotirani to'ldirib bo'lmaydi
  if (webhook) app.post(webhook.path, express.json({ limit: "1mb" }), webhook.handler);

  // Telegram Mini App (webapp/dist) — /app/ ostida. Telegram Web uni iframe da ochadi, shuning uchun
  // frame-ancestors Telegram domenlariga ochiq, SDK esa telegram.org dan yuklanadi
  const webappDist = path.resolve(__dirname, "../../webapp/dist");
  if (existsSync(webappDist)) {
    const webappHeaders = helmet({
      frameguard: false,
      contentSecurityPolicy: {
        directives: {
          "script-src": ["'self'", "https://telegram.org"],
          "img-src": ["'self'", "data:", "blob:", "https://t.me", "https://*.t.me", "https://*.telegram.org"],
          "frame-ancestors": ["'self'", "https://web.telegram.org", "https://*.telegram.org"],
          "connect-src": ["'self'"],
        },
      },
    });
    app.use("/app", webappHeaders, express.static(webappDist, { index: false, maxAge: "1h" }));
    // SPA: istalgan /app/... yo'li index.html (u keshlanmaydi — yangi versiya darhol ko'rinadi)
    app.get(/^\/app(\/.*)?$/, webappHeaders, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(webappDist, "index.html"));
    });
  }

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
  mountProbes(app, runtime);
  mountTrackingRedirect(app, runtime);

  const api = express.Router();
  api.use(
    cors({
      // Admin panel va (alohida hostingda bo'lsa) Mini App manzillari
      origin: [...config.CLIENT_URL.split(",").map((s) => s.trim()), ...(config.WEB_APP_URL ? [new URL(config.WEB_APP_URL).origin] : [])],
      credentials: false,
      // Export fayl nomi (panel alohida domenda bo'lsa ham brauzer o'qiy olishi uchun)
      exposedHeaders: ["Content-Disposition", "X-Export-Total"],
    }),
  );
  api.use(express.json({ limit: "1mb" }));
  // Panel API: IP bo'yicha. Mini App (/app) o'z limitlariga ega (foydalanuvchi ID bo'yicha)
  api.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      skip: (req) => req.path.startsWith("/app/"),
      message: { error: "Juda ko'p so'rov. Birozdan keyin qayta urinib ko'ring.", details: { code: "rate_limited" } },
    }),
  );

  api.use("/auth", authRouter);
  // Telegram Mini App (o'z autentifikatsiyasi bilan — initData)
  api.use("/app", webAppRouter(runtime));

  // Quyidagilarning barchasi JWT talab qiladi
  // Har bir bo'lim o'z ruxsati bilan (rollar jadvali: services/permissions.ts)
  api.use(requireAuth);
  api.use("/dashboard", requirePermission("stats.view"), dashboardRouter);
  api.use("/analytics", requirePermission("stats.view"), analyticsRouter);
  api.use("/bot/commands", requirePermission("content.manage"), commandsRouter);
  api.use("/bot/menu", requirePermission("content.manage"), menuRouter(runtime));
  // Marketing: kampaniya (deep link) havolalari va ularning statistikasi
  api.use("/links", requirePermission("content.manage"), linksRouter(runtime));
  api.use("/bot", botRouter(runtime));
  api.use("/telegram-users", requirePermission("users.view"), telegramUsersRouter(runtime));
  api.use("/messages", requirePermission("users.view"), messagesRouter);
  api.use("/broadcast", requirePermission("broadcast.send"), broadcastRouter(runtime));
  api.use("/orders", requirePermission("orders.review"), ordersRouter(runtime));
  // Narx, video, kanal va kartalar — faqat SUPER_ADMIN (TZ 2.2)
  api.use("/products", requirePermission("products.manage"), productsRouter(runtime));
  // Kurs darslari (videolar): ro'yxat, nom/izoh, tartib, o'chirish. Qo'shish — bot orqali (file_id)
  api.use("/lessons", requirePermission("lessons.manage"), lessonsRouter());
  api.use("/cards", requirePermission("cards.manage"), cardsRouter);
  api.use("/admins", requirePermission("admins.manage"), adminsRouter(runtime));
  api.use("/activity-logs", requirePermission("logs.view"), activityRouter);
  api.use("/errors", requirePermission("logs.view"), errorsRouter);
  api.use(notFound);

  app.use("/api", api);

  // Production: admin panel (admin/dist) shu serverning o'zidan beriladi
  const dist = path.resolve(__dirname, "../../admin/dist");
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/|\/app(\/|$)).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
