import type { Api } from "grammy";
import { Prisma } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db";
import { logger } from "../lib/logger";
import { jobRuns } from "../lib/metrics";
import { flushMessageLog } from "../bot/messageLog";
import { processBroadcasts, stopBroadcastWorker } from "./broadcast";
import { withLease } from "./leases";
import { runAccessChecks } from "./membership";
import { expireStaleOrders } from "./orders";
import { purgeExpiredState } from "./sharedState";
import { purgeOldSupportButtons, syncSupportButtons } from "./supportButtons";

const DELETE_BATCH = 5000;
const ERROR_RETENTION_DAYS = 30;

/**
 * Katta jadvaldan eski yozuvlarni qismlab o'chirish: bitta ulkan DELETE jadvalni uzoq bloklamaydi
 * va WAL/replikatsiyani to'ldirmaydi.
 */
async function deleteOlderThan(table: "messages" | "events", days: number): Promise<number> {
  if (days <= 0) return 0;
  const before = new Date(Date.now() - days * 86400_000);
  let total = 0;
  for (;;) {
    const n =
      table === "messages"
        ? await prisma.$executeRaw`DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE created_at < ${before} LIMIT ${DELETE_BATCH})`
        : await prisma.$executeRaw`DELETE FROM events WHERE id IN (SELECT id FROM events WHERE created_at < ${before} LIMIT ${DELETE_BATCH})`;
    total += n;
    if (n < DELETE_BATCH) return total;
  }
}

async function maintenance(): Promise<void> {
  const [messages, events, state, orders, errors, supportButtons] = [
    await deleteOlderThan("messages", config.MESSAGE_RETENTION_DAYS),
    await deleteOlderThan("events", config.EVENT_RETENTION_DAYS),
    await purgeExpiredState(),
    await expireStaleOrders(),
    // Texnik xatolar: 30 kundan beri takrorlanmaganlari o'chiriladi
    (await prisma.errorLog.deleteMany({ where: { lastSeenAt: { lt: new Date(Date.now() - ERROR_RETENTION_DAYS * 86400_000) } } })).count,
    await purgeOldSupportButtons(),
  ];
  if (messages || events || state || orders || errors || supportButtons) {
    logger.info({ messages, events, state, orders, errors, supportButtons }, "texnik tozalash");
  }
}

/** Bazaga ulanish vaqtincha uzildi (baza qayta ishga tushdi, tarmoq uzilishi) — Prisma keyingi so'rovda qayta ulanadi */
const TRANSIENT_DB_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);
export function isTransientDbError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError && TRANSIENT_DB_CODES.has(err.code)) return true;
  const message = err instanceof Error ? err.message : "";
  return /Server has closed the connection|Can't reach database server|Timed out fetching a new connection/i.test(message);
}

/** Ketma-ket shuncha marta uzilish bo'lsa — endi vaqtinchalik emas: xato (panel «Xatoliklar») */
export const TRANSIENT_FAILURES_BEFORE_ERROR = 3;

/**
 * Fon vazifasi xatosi qanday yoziladi. Bir martalik ulanish uzilishi (masalan, baza qayta ishga tushdi) —
 * keyingi ishga tushishda o'zi tiklanadi: ogohlantirish. Ketma-ket takrorlansa yoki boshqa xato — xato.
 */
export function nextFailure(previous: number, err: unknown): { count: number; level: "warn" | "error" } {
  const count = isTransientDbError(err) ? previous + 1 : Math.max(previous + 1, TRANSIENT_FAILURES_BEFORE_ERROR);
  return { count, level: count < TRANSIENT_FAILURES_BEFORE_ERROR ? "warn" : "error" };
}

interface Job {
  name: string;
  intervalMs: number;
  /** Lease muddati: vazifa shu vaqtdan uzoq ishlasa ham boshqa instans uni olmaydi */
  leaseMs: number;
  /** Birinchi ishga tushish (server start dan keyin) */
  firstRunMs: number;
  run: (api: Api) => Promise<void>;
}

const JOBS: Job[] = [
  // Broadcast worker o'zi lease boshqaradi (uzoq ishlaydi va lease ni yangilab turadi)
  { name: "broadcast", intervalMs: 5_000, leaseMs: 0, firstRunMs: 2_000, run: processBroadcasts },
  { name: "access", intervalMs: 5 * 60_000, leaseMs: 4 * 60_000, firstRunMs: 30_000, run: runAccessChecks },
  // Paneldan support username o'zgarsa — eski xabarlardagi "Yordam" tugmalari yangi havolaga
  { name: "support-buttons", intervalMs: 20_000, leaseMs: 10 * 60_000, firstRunMs: 15_000, run: async (api) => void (await syncSupportButtons(api)) },
  { name: "maintenance", intervalMs: 60 * 60_000, leaseMs: 30 * 60_000, firstRunMs: 60_000, run: () => maintenance() },
];

/**
 * Fon vazifalari. Har bir instans rejalashtiradi, lekin lease tufayli har bir vazifani bir vaqtda
 * faqat bittasi bajaradi — bir nechta server bilan ham takroriy ish (ikki marta xabar, ikki marta
 * kanaldan chiqarish) bo'lmaydi. Redis/BullMQ talab qilinmaydi.
 */
export function startBackgroundJobs(api: Api): () => Promise<void> {
  const running = new Set<Promise<void>>();
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;

  const tick = (job: Job, busy: { v: boolean }, failures: { n: number }) => {
    if (stopped || busy.v) return; // oldingi ishga tushish hali tugamagan
    busy.v = true;
    const task = (async () => {
      try {
        const done = job.leaseMs > 0 ? await withLease(`job:${job.name}`, job.leaseMs, () => job.run(api)) : await job.run(api);
        jobRuns.inc({ job: job.name, result: done === null ? "skipped" : "ok" });
        failures.n = 0;
      } catch (err) {
        jobRuns.inc({ job: job.name, result: "error" });
        const failure = nextFailure(failures.n, err);
        failures.n = failure.count;
        if (failure.level === "warn") {
          logger.warn({ err, job: job.name, attempt: failures.n }, "fon vazifasi: bazaga ulanish vaqtincha uzildi — keyingi ishga tushishda qayta urinadi");
        } else {
          logger.error({ err, job: job.name, ...(failures.n > 1 && { consecutiveFailures: failures.n }) }, "fon vazifasi xatosi");
        }
      } finally {
        busy.v = false;
      }
    })();
    running.add(task);
    void task.finally(() => running.delete(task));
  };

  for (const job of JOBS) {
    const busy = { v: false };
    const failures = { n: 0 };
    timers.push(setTimeout(() => tick(job, busy, failures), job.firstRunMs));
    timers.push(setInterval(() => tick(job, busy, failures), job.intervalMs));
  }

  return async () => {
    stopped = true;
    for (const t of timers) clearTimeout(t);
    await stopBroadcastWorker();
    await Promise.allSettled(running);
    await flushMessageLog();
  };
}
