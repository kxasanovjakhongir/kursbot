import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

/**
 * Prometheus metrikalari (/metrics). Standart jarayon metrikalari: CPU, RAM, event loop lag, GC.
 * Label qiymatlari cheklangan to'plamdan (update turi, HTTP marshrut shabloni) — kardinallik portlamaydi.
 */
export const registry = new Registry();
registry.setDefaultLabels({ service: "darslik-bot" });
collectDefaultMetrics({ register: registry });

const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

// ---------- Bot ----------

export const botUpdates = new Counter({
  name: "bot_updates_total",
  help: "Qayta ishlangan Telegram update lar",
  labelNames: ["type", "status"] as const,
  registers: [registry],
});

export const botUpdateDuration = new Histogram({
  name: "bot_update_duration_seconds",
  help: "Update ni qayta ishlash davomiyligi",
  labelNames: ["type"] as const,
  buckets: LATENCY_BUCKETS,
  registers: [registry],
});

export const botUpdatesInFlight = new Gauge({
  name: "bot_updates_in_flight",
  help: "Hozir qayta ishlanayotgan update lar",
  registers: [registry],
});

export const telegramApiCalls = new Counter({
  name: "telegram_api_calls_total",
  help: "Telegram Bot API chaqiruvlari (natija bo'yicha)",
  labelNames: ["method", "result"] as const,
  registers: [registry],
});

// ---------- HTTP ----------

export const httpRequests = new Counter({
  name: "http_requests_total",
  help: "HTTP so'rovlar",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const httpDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP javob vaqti",
  labelNames: ["method", "route"] as const,
  buckets: LATENCY_BUCKETS,
  registers: [registry],
});

// ---------- Baza va fon vazifalari ----------

export const dbQueryDuration = new Histogram({
  name: "db_query_duration_seconds",
  help: "SQL so'rov davomiyligi",
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 5],
  registers: [registry],
});

export const jobRuns = new Counter({
  name: "job_runs_total",
  help: "Fon vazifalari ishga tushishi",
  labelNames: ["job", "result"] as const,
  registers: [registry],
});
