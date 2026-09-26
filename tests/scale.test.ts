import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { prisma } from "../src/db";
import { acquireLease, INSTANCE_ID, releaseLease, withLease } from "../src/services/leases";
import { purgeExpiredState, SharedState } from "../src/services/sharedState";
import { flushMessageLog, logIncoming } from "../src/bot/messageLog";
import { getSettings, invalidateSettings, setSetting } from "../src/services/settings";
import { getDashboardStats } from "../src/services/stats";
import request from "supertest";
import type { Api } from "grammy";
import { createApp } from "../src/api/app";
import { lifecycle } from "../src/lib/lifecycle";

const enabled = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!enabled)("masshtablash: lease, umumiy holat, buferli log", () => {
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE job_locks, bot_state, messages, settings, users RESTART IDENTITY CASCADE`);
    invalidateSettings();
  });
  afterAll(() => prisma.$disconnect());

  it("lease: boshqa instans egallagan bo'lsa olinmaydi, muddati o'tgach olinadi", async () => {
    await prisma.jobLock.create({ data: { name: "t1", owner: "boshqa-server", expiresAt: new Date(Date.now() + 60_000) } });
    expect(await acquireLease("t1", 10_000)).toBe(false);
    expect(await withLease("t1", 10_000, async () => "bajarildi")).toBeNull();

    await prisma.jobLock.update({ where: { name: "t1" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await acquireLease("t1", 10_000)).toBe(true);
    expect((await prisma.jobLock.findUniqueOrThrow({ where: { name: "t1" } })).owner).toBe(INSTANCE_ID);
    // O'zimizniki — qayta olish = uzaytirish
    expect(await acquireLease("t1", 10_000)).toBe(true);
    await releaseLease("t1");
    expect(await prisma.jobLock.count()).toBe(0);
  });

  it("lease: bir vaqtda 20 ta urinishdan faqat bittasi yutadi", async () => {
    await prisma.jobLock.create({ data: { name: "t2", owner: "boshqa-server", expiresAt: new Date(Date.now() - 1000) } });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        prisma.$queryRaw<{ owner: string }[]>`
          INSERT INTO job_locks (name, owner, expires_at) VALUES ('t2', ${`inst-${i}`}, now() + interval '1 minute')
          ON CONFLICT (name) DO UPDATE SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
          WHERE job_locks.expires_at < now() OR job_locks.owner = EXCLUDED.owner
          RETURNING owner`,
      ),
    );
    expect(results.filter((r) => r.length === 1)).toHaveLength(1);
  });

  it("SharedState: bigint saqlanadi, take atomik, muddati o'tgani qaytmaydi", async () => {
    const state = new SharedState("t", 60_000, z.object({ orderId: z.coerce.bigint(), note: z.string() }));
    await state.set(7, { orderId: 12345678901234n, note: "x" });
    expect(await state.get(7)).toEqual({ orderId: 12345678901234n, note: "x" });

    // Ikki parallel take — faqat bittasi oladi
    const [a, b] = await Promise.all([state.take(7), state.take(7)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await state.get(7)).toBeUndefined();

    // Buzilgan yozuv sxemadan o'tmaydi
    await prisma.botState.create({ data: { key: "t:8", value: { orderId: "abc" }, expiresAt: new Date(Date.now() + 60_000) } });
    expect(await state.get(8)).toBeUndefined();

    const short = new SharedState("s", 1, z.string());
    await short.set(1, "eskiradi");
    await new Promise((r) => setTimeout(r, 10));
    expect(await short.get(1)).toBeUndefined();
    expect(await purgeExpiredState()).toBeGreaterThanOrEqual(1);
  });

  it("xabarlar tarixi paketlab yoziladi va flush da hammasi bazaga tushadi", async () => {
    const user = await prisma.user.create({ data: { telegramId: 5551n, firstName: "Log" } });
    const chat = { id: 5551, type: "private" as const, first_name: "Log" };
    const from = { id: 5551, is_bot: false, first_name: "Log" };
    for (let i = 0; i < 30; i++) {
      await logIncoming({ message_id: i + 1, date: 0, chat, from, text: `m${i}` }, user.id);
    }
    await flushMessageLog();
    expect(await prisma.message.count({ where: { userId: user.id } })).toBe(30);
  });

  it("sozlamalar keshi: yozuvdan keyin darhol yangi qiymat", async () => {
    expect((await getSettings()).maintenance_mode).toBe(false);
    await setSetting("maintenance_mode", true);
    expect((await getSettings()).maintenance_mode).toBe(true);
    await setSetting("maintenance_mode", false);
  });

  it("dashboard: yig'ilgan so'rovlar to'g'ri son qaytaradi", async () => {
    await prisma.user.createMany({ data: [{ telegramId: 5552n, isBlocked: true }, { telegramId: 5553n, isBanned: true }, { telegramId: 5554n, isBot: true }] });
    const s = await getDashboardStats();
    expect(s.users).toMatchObject({ total: 3, blocked: 1, banned: 1, active: 2, newToday: 3 });
    expect(s.messagesToday).toBe(30);
  });

  it("probelar: /health, /ready (bot ishlamasa 503), /metrics faqat token bilan, X-Request-Id", async () => {
    let botRunning = false;
    const app = createApp({ runtime: { api: { token: "t" } as unknown as Api, mode: "polling", tokenSource: "env", isRunning: () => botRunning } });
    expect((await request(app).get("/health")).body.ok).toBe(true);

    lifecycle.markReady();
    const notReady = await request(app).get("/ready");
    expect(notReady.status).toBe(503);
    expect(notReady.body.checks.db.ok).toBe(true);
    botRunning = true;
    expect((await request(app).get("/ready")).status).toBe(200);

    expect((await request(app).get("/metrics")).status).toBe(401);
    expect((await request(app).get("/metrics").set("Authorization", "Bearer noto'g'ri-token-000000")).status).toBe(401);
    const res404 = await request(app).get("/api/yoq-marshrut").set("X-Request-Id", "req-123");
    expect(res404.headers["x-request-id"]).toBe("req-123");
    // Formatga mos kelmagan (log injeksiyasi uchun ishlatilishi mumkin) ID qabul qilinmaydi — yangisi beriladi
    const bad = await request(app).get("/health").set("X-Request-Id", "<script> x");
    expect(bad.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

    const m = await request(app).get("/metrics").set("Authorization", "Bearer test-metrics-token-0123456789");
    expect(m.status).toBe(200);
    expect(m.text).toContain("http_requests_total");
    expect(m.text).toContain("app_active_users_15m");
    expect(m.text).toContain("process_cpu_seconds_total");
    expect(m.text).toContain('route="api_unmatched"');
  });
});
