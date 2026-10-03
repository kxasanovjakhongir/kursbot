import type { Api } from "grammy";
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

  const tick = (job: Job, busy: { v: boolean }) => {
    if (stopped || busy.v) return; // oldingi ishga tushish hali tugamagan
    busy.v = true;
    const task = (async () => {
      try {
        const done = job.leaseMs > 0 ? await withLease(`job:${job.name}`, job.leaseMs, () => job.run(api)) : await job.run(api);
        jobRuns.inc({ job: job.name, result: done === null ? "skipped" : "ok" });
      } catch (err) {
        jobRuns.inc({ job: job.name, result: "error" });
        logger.error({ err, job: job.name }, "fon vazifasi xatosi");
      } finally {
        busy.v = false;
      }
    })();
    running.add(task);
    void task.finally(() => running.delete(task));
  };

  for (const job of JOBS) {
    const busy = { v: false };
    timers.push(setTimeout(() => tick(job, busy), job.firstRunMs));
    timers.push(setInterval(() => tick(job, busy), job.intervalMs));
  }

  return async () => {
    stopped = true;
    for (const t of timers) clearTimeout(t);
    await stopBroadcastWorker();
    await Promise.allSettled(running);
    await flushMessageLog();
  };
}
