import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Router } from "express";
import { Gauge } from "prom-client";
import { config } from "../config";
import { prisma } from "../db";
import { lifecycle } from "../lib/lifecycle";
import { logger } from "../lib/logger";
import { httpDuration, httpRequests, registry } from "../lib/metrics";
import type { BotRuntime } from "./runtime";

const REQUEST_ID_RE = /^[\w-]{1,64}$/;

/** Metrika uchun marshrut shabloni (/api/orders/:id) — haqiqiy ID lar label bo'lib ketmaydi */
function routeLabel(req: Request): string {
  if (req.route?.path) return `${req.baseUrl}${String(req.route.path)}`;
  if (req.path.startsWith("/api/")) return "api_unmatched";
  return "static";
}

/**
 * Har bir HTTP so'rov: request ID (X-Request-Id — proksidan kelsa saqlanadi), metrikalar va
 * tuzilgan log. Query string va body logga yozilmaydi (tokenlar, shaxsiy ma'lumotlar).
 */
export const requestObserver: RequestHandler = (req, res, next) => {
  const incoming = req.get("x-request-id");
  const id = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", id);
  const started = process.hrtime.bigint();

  res.on("finish", () => {
    if (req.path === "/health" || req.path === "/ready" || req.path === "/metrics") return;
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    const route = routeLabel(req);
    httpRequests.inc({ method: req.method, route, status: String(res.statusCode) });
    httpDuration.observe({ method: req.method, route }, seconds);
    if (route === "static") return;
    const entry = {
      reqId: id,
      method: req.method,
      route,
      status: res.statusCode,
      ms: Math.round(seconds * 1000),
      panelUserId: req.panelUser?.id,
      appUserId: req.appSession?.user.id,
    };
    if (res.statusCode >= 500) logger.error(entry, "http");
    else if (res.statusCode >= 400 || seconds > 2) logger.warn(entry, "http");
    else logger.debug(entry, "http");
  });
  next();
};

// Scrape paytida hisoblanadigan biznes metrikalari (indeksli, arzon so'rovlar)
new Gauge({
  name: "app_active_users_15m",
  help: "Oxirgi 15 daqiqada faol foydalanuvchilar",
  registers: [registry],
  async collect() {
    this.set(await prisma.user.count({ where: { lastSeenAt: { gte: new Date(Date.now() - 15 * 60_000) } } }));
  },
});
new Gauge({
  name: "app_broadcast_queue_pending",
  help: "Yuborilishi kutilayotgan broadcast xabarlari",
  registers: [registry],
  async collect() {
    this.set(await prisma.broadcastRecipient.count({ where: { status: "pending" } }));
  },
});
new Gauge({
  name: "app_pending_receipts",
  help: "Admin tekshiruvini kutayotgan cheklar",
  registers: [registry],
  async collect() {
    this.set(await prisma.order.count({ where: { status: "receipt_sent" } }));
  },
});

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function pingDatabase(timeoutMs: number): Promise<{ ok: boolean; ms: number }> {
  const started = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs).unref()),
    ]);
    return { ok: true, ms: Date.now() - started };
  } catch {
    return { ok: false, ms: Date.now() - started };
  }
}

/**
 * /health — liveness: jarayon tirik (orkestrator qayta ishga tushirishi uchun).
 * /ready — readiness: baza javob beradi, bot ishlayapti, to'xtatilmayapti (load balancer uchun).
 * /metrics — Prometheus; faqat METRICS_TOKEN bilan (berilmasa 404).
 */
export function mountProbes(app: Router, runtime: BotRuntime): void {
  app.get("/health", (_req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  });

  app.get("/ready", async (_req, res) => {
    const db = await pingDatabase(2000);
    const bot = runtime.isRunning();
    const ready = lifecycle.isReady && db.ok && bot;
    res.status(ready ? 200 : 503).json({ ready, stopping: lifecycle.isStopping, checks: { db, bot } });
  });

  app.get("/metrics", async (req, res) => {
    if (!config.METRICS_TOKEN) return void res.status(404).json({ error: "Topilmadi" });
    if (!tokenMatches(req.get("authorization"), config.METRICS_TOKEN)) return void res.status(401).json({ error: "Avtorizatsiya talab qilinadi" });
    res.setHeader("Content-Type", registry.contentType);
    res.send(await registry.metrics());
  });
}
