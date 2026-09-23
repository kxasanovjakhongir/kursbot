import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Api } from "grammy";
import type { Express } from "express";
import { prisma } from "../src/db";
import { createApp } from "../src/api/app";
import { createPanelUser } from "../src/services/panelUsers";

const enabled = !!process.env.TEST_DATABASE_URL;

// Telegram API soxtasi — status va xabar yuborish
const sent: number[] = [];
const fakeApi = {
  token: "test",
  getMe: async () => ({ id: 42, is_bot: true, first_name: "Test bot", username: "test_bot" }),
  sendMessage: async (chatId: number) => {
    sent.push(chatId);
    return { message_id: sent.length, chat: { id: chatId } };
  },
  setMyCommands: async () => true,
} as unknown as Api;

describe.skipIf(!enabled)("admin API", () => {
  let app: Express;
  let superToken = "";
  let adminToken = "";

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE activity_logs, broadcast_recipients, broadcasts, panel_users, bot_commands, bot_menu, messages, users RESTART IDENTITY CASCADE`,
    );
    await createPanelUser({ email: "super@test.uz", name: "Super", password: "superpass1", role: "superadmin" });
    await createPanelUser({ email: "admin@test.uz", name: "Admin", password: "adminpass1", role: "admin" });
    await prisma.user.createMany({
      data: [
        { telegramId: 1001n, firstName: "Ali" },
        { telegramId: 1002n, firstName: "Vali", isBlocked: true },
      ],
    });
    app = createApp({ runtime: { api: fakeApi, mode: "polling", tokenSource: "env", isRunning: () => true } });
    superToken = (await request(app).post("/api/auth/login").send({ email: "super@test.uz", password: "superpass1" })).body.token;
    adminToken = (await request(app).post("/api/auth/login").send({ email: "admin@test.uz", password: "adminpass1" })).body.token;
  });
  afterAll(() => prisma.$disconnect());

  it("tokensiz so'rov — 401, noto'g'ri parol — 401, parol javobda yo'q", async () => {
    expect((await request(app).get("/api/dashboard/stats")).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email: "super@test.uz", password: "xato" })).status).toBe(401);
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${superToken}`);
    expect(me.body.user.email).toBe("super@test.uz");
    expect(JSON.stringify(me.body)).not.toContain("password");
  });

  it("ADMIN super admin bo'limlariga kira olmaydi", async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    expect((await request(app).get("/api/admins").set(auth)).status).toBe(403);
    expect((await request(app).get("/api/bot/settings").set(auth)).status).toBe(403);
    expect((await request(app).put("/api/bot/maintenance").set(auth).send({ enabled: true })).status).toBe(403);
    expect((await request(app).get("/api/activity-logs").set(auth)).status).toBe(403);
    expect((await request(app).get("/api/telegram-users").set(auth)).status).toBe(200);
  });

  it("token frontendga chiqmaydi", async () => {
    const res = await request(app).get("/api/bot/settings").set("Authorization", `Bearer ${superToken}`);
    expect(res.status).toBe(200);
    expect(res.body.botToken).toMatch(/^•+$/);
  });

  it("dashboard statistikasi bazadan", async () => {
    const res = await request(app).get("/api/dashboard/stats").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.users).toMatchObject({ total: 2, active: 1, blocked: 1 });
  });

  it("foydalanuvchilarni qidirish va filtrlash", async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const q = await request(app).get("/api/telegram-users?q=ali").set(auth);
    expect(q.body.items.map((u: { firstName: string }) => u.firstName)).toEqual(["Ali", "Vali"]);
    const blocked = await request(app).get("/api/telegram-users?status=blocked").set(auth);
    expect(blocked.body.total).toBe(1);
  });

  it("buyruq validatsiyasi va tizim buyruqlari himoyasi", async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    expect((await request(app).post("/api/bot/commands").set(auth).send({ command: "start", response: "x" })).status).toBe(400);
    const ok = await request(app).post("/api/bot/commands").set(auth).send({ command: "/Help", response: "Yordam" });
    expect(ok.status).toBe(201);
    expect(ok.body.command).toBe("help");
  });

  it("broadcast: bir xil kalit bilan ikki marta yuborilmaydi, bloklaganlar o'tkaziladi", async () => {
    const auth = { Authorization: `Bearer ${superToken}` };
    const body = { messageType: "text", text: "Salom", audience: "all", idempotencyKey: "11111111-1111-4111-8111-111111111111" };
    const first = await request(app).post("/api/broadcast").set(auth).field(body);
    const second = await request(app).post("/api/broadcast").set(auth).field(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(await prisma.broadcast.count()).toBe(1);

    const id = first.body.broadcast.id as number;
    for (let i = 0; i < 50; i++) {
      const b = await prisma.broadcast.findUniqueOrThrow({ where: { id } });
      if (b.status === "completed") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const done = await prisma.broadcast.findUniqueOrThrow({ where: { id } });
    expect(done).toMatchObject({ status: "completed", total: 2, sent: 1, skipped: 1, failed: 0 });
    expect(sent).toEqual([1001]);
  });

  it("oxirgi super adminni o'chirib bo'lmaydi; harakatlar loglanadi", async () => {
    const auth = { Authorization: `Bearer ${superToken}` };
    expect((await request(app).delete("/api/admins/1").set(auth)).status).toBe(400);
    const logs = await request(app).get("/api/activity-logs").set(auth);
    const actions = logs.body.items.map((l: { action: string }) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["LOGIN", "LOGIN_FAILED", "CREATE_BROADCAST"]));
  });
});
