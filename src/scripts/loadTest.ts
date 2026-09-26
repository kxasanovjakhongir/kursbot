/**
 * Load test: haqiqiy bot kodi (middleware, handlerlar, Prisma) + haqiqiy PostgreSQL,
 * Telegram API esa tarmoqsiz soxta javob bilan (sozlanadigan kechikish).
 *
 *   npm run loadtest -- bot     --users 10000 --rate 500 --duration 20 --concurrency 100 [--tg-error-rate 0.05]
 *   npm run loadtest -- stress  --rates 100,500,1000,2000,5000,10000,20000 --duration 10
 *   npm run loadtest -- spike   --bursts 5000,20000
 *   npm run loadtest -- soak    --minutes 30 --rate 200      (aniq heap: NODE_OPTIONS=--expose-gc)
 *   npm run loadtest -- failure --rate 200                    (Telegram 10 s ishlamaydi)
 *   npm run loadtest -- http    --users 1000 --concurrency 100 --requests 5000
 *
 * bot rejimi: update lar berilgan tezlikda (rate/s) keladi; kechikish = kelgan paytdan
 * javob tugaguncha (navbatda kutish ham kiradi). --concurrency 1 — grammY'ning oddiy
 * polling'i kabi ketma-ket; >1 — parallel (runner kabi, bitta chat ichida tartib saqlanadi).
 *
 * FAQAT test bazasida ishga tushiring: foydalanuvchilar va buyurtmalar yaratiladi.
 */
import { performance } from "node:perf_hooks";
import type { AddressInfo } from "node:net";
import { Api } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { config } from "../config";
import { prisma } from "../db";
import { createApp } from "../api/app";
import { createBot } from "../bot/bot";
import { signInitData } from "../lib/telegramAuth";
import { botUpdates } from "../lib/metrics";

// ---------- Argumentlar ----------

const args = process.argv.slice(2);
const mode = args[0] ?? "bot";
function num(name: string, def: number): number {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? Number(args[i + 1]) : def;
  if (!Number.isFinite(v) || v <= 0) throw new Error(`--${name} musbat son bo'lishi kerak`);
  return v;
}

function assertTestDatabase(): void {
  const db = new URL(config.DATABASE_URL).pathname.slice(1);
  if (process.env.NODE_ENV === "production" || (!db.includes("test") && !args.includes("--force"))) {
    throw new Error(`Load test faqat test bazasida ishlaydi (hozir: "${db}"). DATABASE_URL ni test bazasiga yo'naltiring`);
  }
}

// ---------- Statistika ----------

interface Summary {
  count: number;
  errors: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  rps: number;
}

function summarize(latencies: number[], errors: number, wallMs: number): Summary {
  const s = [...latencies].sort((a, b) => a - b);
  const pct = (p: number) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
  const avg = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return { count: s.length, errors, avg, p50: pct(50), p95: pct(95), p99: pct(99), max: s.at(-1) ?? 0, rps: (s.length / wallMs) * 1000 };
}

function printSummary(title: string, sum: Summary, extra: Record<string, string | number>): void {
  const f = (n: number) => `${n.toFixed(1)} ms`;
  console.log(`\n=== ${title} ===`);
  console.log(`  so'rovlar: ${sum.count}   xatolar: ${sum.errors} (${((sum.errors / Math.max(1, sum.count)) * 100).toFixed(2)}%)`);
  console.log(`  o'rtacha: ${f(sum.avg)}   p50: ${f(sum.p50)}   p95: ${f(sum.p95)}   p99: ${f(sum.p99)}   max: ${f(sum.max)}`);
  console.log(`  throughput: ${sum.rps.toFixed(1)} /s`);
  for (const [k, v] of Object.entries(extra)) console.log(`  ${k}: ${v}`);
}

/** CPU (%) va RAM — test davomida */
function resourceMeter() {
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  let peakRss = process.memoryUsage().rss;
  const timer = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 100);
  return () => {
    clearInterval(timer);
    const cpu = process.cpuUsage(cpu0);
    const wall = performance.now() - t0;
    return {
      "CPU (1 yadro)": `${(((cpu.user + cpu.system) / 1000 / wall) * 100).toFixed(0)}%`,
      "RAM (peak RSS)": `${(peakRss / 1024 / 1024).toFixed(0)} MB`,
    };
  };
}

async function dbStats() {
  const rows = await prisma.$queryRaw<{ xact_commit: bigint; tup_fetched: bigint; tup_inserted: bigint; tup_updated: bigint }[]>`
    SELECT xact_commit, tup_fetched, tup_inserted, tup_updated FROM pg_stat_database WHERE datname = current_database()`;
  return rows[0];
}

// ---------- Soxta Telegram API (tarmoqqa chiqmaydi) ----------

const TG_LATENCY_MS = num("tg-latency", 60);
let tgCalls = 0;
let tgFailures = 0;
/** Nosozlik simulyatsiyasi: tasodifiy 429/502 ulushi va "Telegram butunlay ishlamayapti" oynasi */
const tgFault = { errorRate: 0, downUntil: 0 };

function fakeMessage(chatId: number) {
  return { message_id: ++tgCalls, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: "private", first_name: "U" }, text: "ok" };
}

/** grammY barcha API chaqiruvlarini shu fetch orqali yuboradi — tarmoqqa chiqilmaydi */
const fakeFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = url.slice(url.lastIndexOf("/") + 1);
  let chatId = 1;
  if (typeof init?.body === "string") {
    const body: unknown = JSON.parse(init.body);
    if (typeof body === "object" && body !== null && "chat_id" in body) chatId = Number(body.chat_id);
  }
  tgCalls++;
  await new Promise((r) => setTimeout(r, TG_LATENCY_MS * (0.5 + Math.random())));
  if (Date.now() < tgFault.downUntil) {
    tgFailures++;
    throw new TypeError("fetch failed (simulyatsiya: Telegram ishlamayapti)");
  }
  if (tgFault.errorRate > 0 && Math.random() < tgFault.errorRate) {
    tgFailures++;
    const flood = Math.random() < 0.5;
    const body = flood
      ? { ok: false, error_code: 429, description: "Too Many Requests: retry after 1", parameters: { retry_after: 1 } }
      : { ok: false, error_code: 502, description: "Bad Gateway" };
    return new Response(JSON.stringify(body), { status: flood ? 429 : 502, headers: { "content-type": "application/json" } });
  }
  const result = method.startsWith("send") || method === "editMessageText" ? fakeMessage(chatId) : true;
  return new Response(JSON.stringify({ ok: true, result }), { headers: { "content-type": "application/json" } });
};

const botInfo: UserFromGetMe = {
  id: 42,
  is_bot: true,
  first_name: "Load test",
  username: "load_test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

// ---------- Ma'lumotlar ----------

const BASE_ID = 9_000_000_000;

async function seedProducts(): Promise<string[]> {
  for (const [code, title] of [["lt1", "Load test 1"], ["lt2", "Load test 2"]] as const) {
    await prisma.product.upsert({ where: { code }, create: { code, title, price: 100_000, isActive: true }, update: { isActive: true } });
  }
  return ["lt1", "lt2"];
}

/** Haqiqiy foydalanuvchi xatti-harakatiga yaqin aralashma */
function makeUpdate(updateId: number, userIndex: number, codes: string[]): Update {
  const from = { id: BASE_ID + userIndex, is_bot: false, first_name: `U${userIndex}`, language_code: "uz" };
  const chat = { id: from.id, type: "private" as const, first_name: from.first_name };
  const date = Math.floor(Date.now() / 1000);
  const r = Math.random();
  if (r < 0.35) {
    return { update_id: updateId, message: { message_id: updateId, date, chat, from, text: "/start", entities: [{ type: "bot_command", offset: 0, length: 6 }] } };
  }
  if (r < 0.55) return { update_id: updateId, message: { message_id: updateId, date, chat, from, text: "salom" } };
  const data = r < 0.8 ? "nav:cat:1" : `p:${codes[userIndex % codes.length]}`;
  return {
    update_id: updateId,
    callback_query: { id: String(updateId), from, chat_instance: "ci", data, message: { message_id: 1, date, chat, text: "menu" } },
  };
}

// ---------- 1. Bot: drayver (runner kabi — parallel, bitta chat ichida ketma-ket) ----------

async function dbConnections(): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database()`;
  return Number(rows[0].n);
}

const errorCount = async () => (await botUpdates.get()).values.filter((v) => v.labels.status === "error").reduce((a, v) => a + v.value, 0);

/**
 * Update lar navbati: har bir chat uchun alohida navbat + "tayyor chatlar" ro'yxati (O(1)).
 * Kechikish — update kelgan paytdan javob tugaguncha (navbatda kutish ham kiradi).
 */
class Driver {
  private chats = new Map<number, { update: Update; arrived: number }[]>();
  private ready: number[] = [];
  private busy = new Set<number>();
  private active = 0;
  private waiters: (() => void)[] = [];
  latencies: number[] = [];
  pending = 0;
  maxPending = 0;
  failed = 0;
  private nextId = 1;

  constructor(
    private bot: ReturnType<typeof createBot>,
    private concurrency: number,
    private users: number,
    private codes: string[],
  ) {}

  push(count: number): void {
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const update = makeUpdate(this.nextId++, Math.floor(Math.random() * this.users), this.codes);
      const chatId = update.message?.chat.id ?? update.callback_query?.from.id ?? 0;
      let q = this.chats.get(chatId);
      if (!q) this.chats.set(chatId, (q = []));
      q.push({ update, arrived: now });
      if (q.length === 1 && !this.busy.has(chatId)) this.ready.push(chatId);
    }
    this.pending += count;
    this.maxPending = Math.max(this.maxPending, this.pending);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.concurrency && this.ready.length) {
      const chatId = this.ready.shift()!;
      const q = this.chats.get(chatId)!;
      const item = q.shift()!;
      if (q.length === 0) this.chats.delete(chatId);
      this.busy.add(chatId);
      this.active++;
      this.bot
        .handleUpdate(item.update)
        .catch(() => this.failed++)
        .finally(() => {
          this.latencies.push(performance.now() - item.arrived);
          this.busy.delete(chatId);
          this.active--;
          this.pending--;
          if (this.chats.get(chatId)?.length) this.ready.push(chatId);
          if (this.pending === 0) this.waiters.splice(0).forEach((w) => w());
          this.pump();
        });
    }
  }

  drain(): Promise<void> {
    return this.pending === 0 ? Promise.resolve() : new Promise((r) => this.waiters.push(r));
  }

  /** Bir tekis oqim: rate update/s × seconds */
  async feed(rate: number, seconds: number): Promise<void> {
    const total = Math.round(rate * seconds);
    const tickMs = 10;
    let produced = 0;
    let carry = 0;
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        carry += (rate * tickMs) / 1000;
        const n = Math.min(Math.floor(carry), total - produced);
        carry -= n;
        produced += n;
        if (n) this.push(n);
        if (produced >= total) {
          clearInterval(timer);
          resolve();
        }
      }, tickMs);
    });
  }

  reset(): void {
    this.latencies = [];
    this.maxPending = this.pending;
    this.failed = 0;
  }
}

interface PhaseResult {
  title: string;
  sum: Summary;
  extra: Record<string, string | number>;
}

/** Bosqichni o'lchaydi: kechikish, xatolar, CPU/RAM, DB ulanishlari va tranzaksiyalar, Telegram chaqiruvlari */
async function measure(title: string, driver: Driver, run: () => Promise<void>): Promise<PhaseResult> {
  driver.reset();
  const [db0, err0] = [await dbStats(), await errorCount()];
  const calls0 = tgCalls;
  const fails0 = tgFailures;
  let maxConn = 0;
  // Baza uzilgan paytda ham o'lchov davom etadi (xato — shu nuqta o'tkazib yuboriladi)
  const connTimer = setInterval(() => void dbConnections().then((n) => (maxConn = Math.max(maxConn, n)), () => undefined), 500);
  const stopMeter = resourceMeter();
  const started = performance.now();
  await run();
  await driver.drain();
  const wall = performance.now() - started;
  clearInterval(connTimer);
  const resources = stopMeter();
  const db1 = await dbStats().catch(() => db0);
  const errors = driver.failed + ((await errorCount()) - err0);
  return {
    title,
    sum: summarize(driver.latencies, errors, wall),
    extra: {
      ...resources,
      "navbat (max kutayotgan)": driver.maxPending,
      "DB ulanishlar (max)": maxConn,
      "DB tranzaksiyalar/s": Math.round((Number(db1.xact_commit - db0.xact_commit) / wall) * 1000),
      "Telegram API chaqiruvlari": tgCalls - calls0,
      "Telegram xatolari (simulyatsiya)": tgFailures - fails0,
    },
  };
}

async function makeDriver() {
  const users = num("users", 10000);
  const concurrency = num("concurrency", 100);
  const codes = await seedProducts();
  const bot = createBot("1:load-test-token", { botInfo, client: { fetch: fakeFetch } });
  await bot.init();
  return { driver: new Driver(bot, concurrency, users, codes), users, concurrency };
}

/** bot: bitta doimiy yuklama */
async function botLoad(): Promise<void> {
  const rate = num("rate", 200);
  const duration = num("duration", 15);
  tgFault.errorRate = Number(args[args.indexOf("--tg-error-rate") + 1]) || 0;
  const { driver, users, concurrency } = await makeDriver();
  const r = await measure(`BOT: ${users} foydalanuvchi, ${rate} update/s × ${duration}s, concurrency=${concurrency}`, driver, () => driver.feed(rate, duration));
  printSummary(r.title, r.sum, r.extra);
}

/** stress: yuklama bosqichma-bosqich oshiriladi — qaysi nuqtada tizim kelgan yuklamaga ulgurmay qoladi */
async function stressLoad(): Promise<void> {
  const rates = (args[args.indexOf("--rates") + 1] ?? "100,500,1000,2000,5000,10000,20000").split(",").map(Number);
  const duration = num("duration", 10);
  const { driver, concurrency } = await makeDriver();
  const rows: string[] = [];
  for (const rate of rates) {
    const r = await measure(`STRESS ${rate} update/s × ${duration}s`, driver, () => driver.feed(rate, duration));
    printSummary(r.title, r.sum, r.extra);
    const sustained = r.sum.rps >= rate * 0.95 && r.sum.p95 < 2000;
    rows.push(
      `${String(rate).padStart(6)} | ${r.sum.rps.toFixed(0).padStart(6)} | ${r.sum.p50.toFixed(0).padStart(6)} | ${r.sum.p95.toFixed(0).padStart(7)} | ${r.sum.p99.toFixed(0).padStart(7)} | ${String(r.sum.errors).padStart(5)} | ${String(r.extra["CPU (1 yadro)"]).padStart(5)} | ${String(r.extra["RAM (peak RSS)"]).padStart(7)} | ${String(r.extra["DB ulanishlar (max)"]).padStart(4)} | ${sustained ? "ha" : "YO'Q"}`,
    );
  }
  console.log(`\n=== STRESS jamlanma (concurrency=${concurrency}, Telegram kechikishi ~${TG_LATENCY_MS} ms) ===`);
  console.log("  kelgan/s | ishlandi/s | p50 ms | p95 ms  | p99 ms  | xato  | CPU   | RAM     | DB   | ulguradimi");
  for (const row of rows) console.log(`  ${row}`);
}

/** spike: tinch oqim → birdaniga katta portlashlar → yana tinch. Tizim yiqiladimi, update yo'qolmaydimi, tiklanadimi */
async function spikeLoad(): Promise<void> {
  const bursts = (args[args.indexOf("--bursts") + 1] ?? "5000,20000").split(",").map(Number);
  const { driver } = await makeDriver();
  const base = await measure("SPIKE: tinch oqim 100/s × 5s (oldin)", driver, () => driver.feed(100, 5));
  printSummary(base.title, base.sum, base.extra);
  for (const n of bursts) {
    const r = await measure(`SPIKE: birdaniga ${n} update (100/s fonda)`, driver, async () => {
      driver.push(n);
      await driver.feed(100, 3);
    });
    printSummary(r.title, r.sum, { ...r.extra, "yetkazilgan / yuborilgan": `${r.sum.count} / ${n + 300}` });
  }
  const after = await measure("SPIKE: tinch oqim 100/s × 5s (keyin — tiklanish)", driver, () => driver.feed(100, 5));
  printSummary(after.title, after.sum, after.extra);
}

/** soak: uzoq muddat o'rtacha yuklama — xotira (GC dan keyin heap), RSS va DB ulanishlari trendi */
async function soakLoad(): Promise<void> {
  const minutes = num("minutes", 30);
  const rate = num("rate", 200);
  const { driver } = await makeDriver();
  const gc = (globalThis as { gc?: () => void }).gc;
  console.log(`SOAK: ${rate} update/s × ${minutes} daqiqa${gc ? "" : " (aniq heap uchun: NODE_OPTIONS=--expose-gc)"}`);
  console.log("  daqiqa | ishlandi | p95 ms | heap MB (GC dan keyin) | RSS MB | DB ulanish | xato");
  const heaps: number[] = [];
  for (let m = 1; m <= minutes; m++) {
    const r = await measure(`soak ${m}`, driver, () => driver.feed(rate, 60));
    gc?.();
    const heap = process.memoryUsage().heapUsed / 1024 / 1024;
    heaps.push(heap);
    console.log(
      `  ${String(m).padStart(6)} | ${String(r.sum.count).padStart(8)} | ${r.sum.p95.toFixed(0).padStart(6)} | ${heap.toFixed(1).padStart(22)} | ${String((process.memoryUsage().rss / 1024 / 1024).toFixed(0)).padStart(6)} | ${String(r.extra["DB ulanishlar (max)"]).padStart(10)} | ${r.sum.errors}`,
    );
  }
  // Oxirgi yarmidagi o'sish (isitishdan keyin): leak bo'lsa heap to'xtovsiz oshadi
  const half = heaps.slice(Math.floor(heaps.length / 2));
  const growth = half.length > 1 ? (half[half.length - 1] - half[0]) / (half.length - 1) : 0;
  console.log(`\n  heap trendi (2-yarmi): ${growth >= 0 ? "+" : ""}${growth.toFixed(2)} MB/daqiqa → ${Math.abs(growth) < 1 ? "barqaror (leak belgisi yo'q)" : "O'SISH — tekshirish kerak"}`);
}

/** failure: Telegram API vaqtincha butunlay ishlamaydi → bot qulamaydimi, qayta tiklanadimi */
async function failureLoad(): Promise<void> {
  const { driver } = await makeDriver();
  const rate = num("rate", 200);
  const r = await measure(`FAILURE: Telegram 10s ishlamaydi (${rate}/s, 30s)`, driver, async () => {
    setTimeout(() => (tgFault.downUntil = Date.now() + 10_000), 10_000);
    await driver.feed(rate, 30);
  });
  printSummary(r.title, r.sum, r.extra);
  const after = await measure(`FAILURE: tiklangandan keyin (${rate}/s, 10s)`, driver, () => driver.feed(rate, 10));
  printSummary(after.title, after.sum, after.extra);
}

// ---------- 2. Mini App HTTP API ----------

async function httpLoad(): Promise<void> {
  const users = num("users", 200);
  const concurrency = num("concurrency", 50);
  const requests = num("requests", 2000);
  await seedProducts();

  const token = config.BOT_TOKEN;
  const api = new Api(token, { fetch: fakeFetch });
  const app = createApp({ runtime: { api, mode: "polling", tokenSource: "env", isRunning: () => true } });
  const server = app.listen(0);
  // Production (index.ts) bilan bir xil: keep-alive klientnikidan uzun — yopilayotgan soket qayta ishlatilmaydi
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/app`;

  // Har bir virtual foydalanuvchi initData bilan kiradi (auth ham o'lchanadi)
  const tokens: string[] = [];
  for (let i = 0; i < users; i++) {
    const initData = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: BASE_ID + i, first_name: `U${i}` }) }, token);
    const res = await fetch(`${base}/auth/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.${i >> 8}.${i & 255}` },
      body: JSON.stringify({ initData }),
    });
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && "token" in body && typeof body.token === "string") tokens.push(body.token);
  }
  if (tokens.length === 0) throw new Error("Hech bir foydalanuvchi kira olmadi");

  const paths = ["/products", "/me", "/orders?pageSize=10", "/purchases", "/notifications"];
  const latencies: number[] = [];
  let errors = 0;
  let sent = 0;
  const errorKinds = new Map<string, number>();
  const countError = (kind: string) => {
    errors++;
    errorKinds.set(kind, (errorKinds.get(kind) ?? 0) + 1);
  };
  const db0 = await dbStats();
  const stopMeter = resourceMeter();
  const started = performance.now();

  const worker = async (w: number) => {
    while (sent < requests) {
      const n = sent++;
      const i = n % tokens.length;
      const t0 = performance.now();
      try {
        const res = await fetch(`${base}${paths[n % paths.length]}`, {
          headers: { authorization: `Bearer ${tokens[i]}`, "x-forwarded-for": `10.1.${w >> 8}.${w & 255}` },
        });
        await res.arrayBuffer();
        if (!res.ok) countError(`HTTP ${res.status}`);
      } catch (err) {
        const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : String(err);
        countError(cause.slice(0, 60));
      }
      latencies.push(performance.now() - t0);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, (_, w) => worker(w)));

  const wall = performance.now() - started;
  const resources = stopMeter();
  const db1 = await dbStats();
  server.close();
  printSummary(`HTTP (Mini App API): ${tokens.length} foydalanuvchi, concurrency=${concurrency}`, summarize(latencies, errors, wall), {
    ...resources,
    "DB tranzaksiyalar": Number(db1.xact_commit - db0.xact_commit),
    ...(errorKinds.size ? { "xato turlari": [...errorKinds].map(([k, v]) => `${k}: ${v}`).join("; ") } : {}),
  });
}

async function main() {
  assertTestDatabase();
  const modes: Record<string, () => Promise<void>> = { bot: botLoad, http: httpLoad, stress: stressLoad, spike: spikeLoad, soak: soakLoad, failure: failureLoad };
  await (modes[mode] ?? botLoad)();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
