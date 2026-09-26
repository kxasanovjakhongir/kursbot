import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { webhookCallback, type Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import type { Express } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { createApp } from "../src/api/app";
import { createBot } from "../src/bot/bot";
import type { BotContext } from "../src/bot/context";
import { setRetryDatabaseErrors } from "../src/bot/middleware/errorBoundary";
import { createPanelUser } from "../src/services/panelUsers";
import { addCard } from "../src/services/cards";
import { invalidateSettings } from "../src/services/settings";
import { resolveEntry } from "../src/services/campaignLinks";

const enabled = !!process.env.TEST_DATABASE_URL;
const SECRET = "webhook-secret-for-tests-0123";
const BOT_INFO: UserFromGetMe = {
  id: 42,
  is_bot: true,
  first_name: "Test",
  username: "test_bot",
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

const calls: { method: string; payload: Record<string, unknown> }[] = [];
let seq = 0;
let updateId = 1000;

function makeBot(): Bot<BotContext> {
  const bot = createBot("123:test-token", { botInfo: BOT_INFO });
  bot.api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    const result = method.startsWith("send") || method === "editMessageText" ? { message_id: ++seq, date: 0, chat: { id: Number(p.chat_id), type: "private" }, text: p.text } : true;
    return { ok: true, result } as unknown as Awaited<ReturnType<typeof _prev>>;
  });
  // Baza xatosini simulyatsiya: edited_message ni hech bir handler ushlamaydi — oxirigacha yetib keladi
  bot.on("edited_message", () => {
    throw new Prisma.PrismaClientKnownRequestError("Can't reach database server", { code: "P1001", clientVersion: "test" });
  });
  return bot;
}

const USER = { id: 6001, is_bot: false as const, first_name: "Oddiy", language_code: "uz" };
const chat = { id: USER.id, type: "private" as const, first_name: "Oddiy" };
const text = (t: string, from = USER): Update => ({
  update_id: updateId++,
  message: {
    message_id: ++seq,
    date: 0,
    chat: { ...chat, id: from.id },
    from,
    text: t,
    entities: t.startsWith("/") ? [{ type: "bot_command", offset: 0, length: t.split(" ")[0].length }] : undefined,
  },
});
const cb = (data: string): Update => ({
  update_id: updateId++,
  callback_query: { id: String(updateId), from: USER, chat_instance: "ci", data, message: { message_id: 1, date: 0, chat, text: "x" } },
});

describe.skipIf(!enabled)("xavfsizlik testlari", () => {
  let bot: Bot<BotContext>;
  let app: Express;
  let superToken = "";

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE bot_state, audit_log, activity_logs, panel_users, events, messages, notifications, receipts, access_grants, orders, cards, products, admins, settings, texts, users RESTART IDENTITY CASCADE`,
    );
    invalidateSettings();
    await prisma.product.create({ data: { code: "4b", title: "Darslik", price: 100_000, channelId: -1001n } });
    await addCard("8600123412341234", "A. Karimov");
    await createPanelUser({ email: "super@test.uz", name: "Super", password: "superpass1", role: "superadmin" });
    bot = makeBot();
    await bot.init();
    app = createApp({
      runtime: { api: bot.api, mode: "webhook", tokenSource: "env", isRunning: () => true },
      webhook: { path: "/telegram/webhook", handler: webhookCallback(bot, "express", { secretToken: SECRET }) },
    });
    superToken = (await request(app).post("/api/auth/login").send({ email: "super@test.uz", password: "superpass1" })).body.token;
  });
  beforeEach(() => {
    calls.length = 0;
    setRetryDatabaseErrors(false);
  });
  afterAll(() => prisma.$disconnect());

  // ---------- Webhook ----------

  it("webhook: secret yo'q yoki noto'g'ri — 401, update qayta ishlanmaydi; to'g'ri — 200", async () => {
    const post = (headers: Record<string, string>, body: unknown) => request(app).post("/telegram/webhook").set(headers).send(body as object);
    expect((await post({}, text("/start"))).status).toBe(401);
    expect((await post({ "X-Telegram-Bot-Api-Secret-Token": "noto'g'ri" }, text("/start"))).status).toBe(401);
    expect(await prisma.user.count({ where: { telegramId: BigInt(USER.id) } })).toBe(0);

    expect((await post({ "X-Telegram-Bot-Api-Secret-Token": SECRET }, text("/start"))).status).toBe(200);
    expect(await prisma.user.count({ where: { telegramId: BigInt(USER.id) } })).toBe(1);
  });

  it("webhook: buzuq JSON — 400, 1 MB dan katta body — 413", async () => {
    const h = { "X-Telegram-Bot-Api-Secret-Token": SECRET, "Content-Type": "application/json" };
    expect((await request(app).post("/telegram/webhook").set(h).send("{buzuq")).status).toBe(400);
    expect((await request(app).post("/telegram/webhook").set(h).send(JSON.stringify({ update_id: 1, x: "a".repeat(1_100_000) }))).status).toBe(413);
  });

  it("webhook: baza ishlamasa — Telegram'ga xato (qayta yuboradi), foydalanuvchiga xabar yuborilmaydi; polling da — xabar", async () => {
    const edited = (): Update => ({ update_id: updateId++, edited_message: { message_id: 5, date: 0, edit_date: 1, chat, from: USER, text: "x" } });
    setRetryDatabaseErrors(true);
    const res = await request(app).post("/telegram/webhook").set("X-Telegram-Bot-Api-Secret-Token", SECRET).send(edited());
    expect(res.status).toBe(500);
    expect(calls.filter((c) => c.method === "sendMessage" && Number(c.payload.chat_id) === USER.id)).toHaveLength(0);

    setRetryDatabaseErrors(false);
    calls.length = 0;
    expect((await request(app).post("/telegram/webhook").set("X-Telegram-Bot-Api-Secret-Token", SECRET).send(edited())).status).toBe(200);
    expect(calls.some((c) => c.method === "sendMessage" && Number(c.payload.chat_id) === USER.id)).toBe(true);
  });

  // ---------- Zararli update / callback ----------

  it("zararli callback va update lar botni yiqitmaydi va hech narsani o'zgartirmaydi", async () => {
    const orders0 = await prisma.order.count();
    for (const data of ["p:../../etc/passwd", "buy:4b' OR 1=1 --", "adm:ad:n:1:s", "ap:admins", "adm:ap:1", "ord:cancel:99999999999999999999", "x".repeat(64), "", "pi:4b:<script>"]) {
      await bot.handleUpdate(cb(data));
    }
    // Oddiy foydalanuvchi admin buyruqlarini ishlata olmaydi
    for (const t of ["/admin", "/addadmin 6001 super", "/setprice 4b 1", "/pending", "/order 1"]) await bot.handleUpdate(text(t));
    expect(await prisma.admin.count()).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { code: "4b" } })).price).toBe(100_000);
    expect(await prisma.order.count()).toBe(orders0);
    // "from" siz, kanal posti va noma'lum turdagi update lar
    await bot.handleUpdate({ update_id: updateId++, channel_post: { message_id: 1, date: 0, chat: { id: -100, type: "channel", title: "k" }, text: "x" } });
    await bot.handleUpdate({ update_id: updateId++, message: { message_id: 1, date: 0, chat, text: "egasiz" } } as unknown as Update);
  });

  it("start/startapp parametri: injeksiya, juda uzun, maxsus belgilar — xavfsiz rad etiladi", async () => {
    for (const p of ["' OR 1=1 --", "a".repeat(500), "../../.env", "c<script>", "course_1;DROP TABLE users"]) {
      expect((await resolveEntry(p)).kind).toBe("unavailable");
    }
    await bot.handleUpdate(text("/start ' OR 1=1 --"));
    expect(await prisma.user.count()).toBeGreaterThan(0);
  });

  // ---------- Panel API ----------

  it("SQL injection matnlari qidiruvda oddiy matn sifatida ishlaydi", async () => {
    for (const q of ["' OR 1=1 --", "'; DROP TABLE users; --", "\\\\x00", "%_%"]) {
      const res = await request(app).get(`/api/telegram-users?q=${encodeURIComponent(q)}`).set("Authorization", `Bearer ${superToken}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
    }
    expect(await prisma.user.count()).toBeGreaterThan(0);
  });

  it("soxta JWT: boshqa kalit, alg=none, muddati o'tgan — 401", async () => {
    const forged = jwt.sign({ sub: "1", pv: "x" }, "boshqa-kalit-boshqa-kalit-boshqa-kalit");
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from('{"sub":"1"}').toString("base64url")}.`;
    const expired = jwt.sign({ sub: "1", pv: "x" }, process.env.JWT_SECRET!, { expiresIn: -10 });
    for (const t of [forged, none, expired, "abc"]) {
      expect((await request(app).get("/api/dashboard").set("Authorization", `Bearer ${t}`)).status).toBe(401);
    }
  });

  it("parol o'zgartirilsa — eski sessiyalar bekor, yangi token ishlaydi", async () => {
    const other = (await request(app).post("/api/auth/login").send({ email: "super@test.uz", password: "superpass1" })).body.token as string;
    const res = await request(app).put("/api/auth/password").set("Authorization", `Bearer ${superToken}`).send({ currentPassword: "superpass1", newPassword: "superpass2" });
    expect(res.status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${other}`)).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${res.body.token}`)).status).toBe(200);
    superToken = res.body.token;
  });

  it("brute force: bir akkauntga turli IP lardan 10 ta xato urinishdan keyin — 429", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await request(app).post("/api/auth/login").set("X-Forwarded-For", `10.9.0.${i}`).send({ email: "super@test.uz", password: "noto'g'ri" });
      codes.push(r.status);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });

  it("path traversal va .env: maxfiy fayllar hech qachon qaytarilmaydi", async () => {
    for (const p of ["/app/..%2F..%2F.env", "/..%2F.env", "/app/%2e%2e/%2e%2e/package.json", "/.env", "/app/../../src/config.ts"]) {
      const res = await request(app).get(p);
      expect(res.text).not.toContain("BOT_TOKEN");
      expect(res.text).not.toContain("JWT_SECRET");
    }
  });
});
