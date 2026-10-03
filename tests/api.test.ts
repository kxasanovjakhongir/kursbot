import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Api } from "grammy";
import type { Express } from "express";
import { prisma } from "../src/db";
import { createApp } from "../src/api/app";
import { createPanelUser } from "../src/services/panelUsers";
import { invalidateSettings } from "../src/services/settings";
import { errorSinkStream, flushErrorLogs } from "../src/lib/errorSink";

const enabled = !!process.env.TEST_DATABASE_URL;

// Telegram API soxtasi — status va xabar yuborish
const sent: number[] = [];
const photoCalls: { chatId: number; byFileId: boolean }[] = [];
const kicked: number[] = [];
const fakeApi = {
  token: "test",
  getMe: async () => ({ id: 42, is_bot: true, first_name: "Test bot", username: "test_bot" }),
  sendMessage: async (chatId: number) => {
    sent.push(chatId);
    return { message_id: sent.length, chat: { id: chatId } };
  },
  setMyCommands: async () => true,
  // Media: fayl (InputFile) saqlash chatiga yuklanadi, qabul qiluvchilarga esa file_id yuboriladi
  sendPhoto: async (chatId: number, photo: unknown) => {
    photoCalls.push({ chatId, byFileId: typeof photo === "string" });
    return { message_id: 900 + photoCalls.length, chat: { id: chatId }, photo: [{ file_id: "stored-photo", file_unique_id: "sp", width: 1, height: 1 }] };
  },
  createChatInviteLink: async () => ({ invite_link: `https://t.me/+panel${sent.length}` }),
  editMessageCaption: async () => true,
  editMessageText: async () => true,
  banChatMember: async (_chat: number, userId: number) => {
    kicked.push(userId);
    return true;
  },
  unbanChatMember: async () => true,
  revokeChatInviteLink: async () => true,
  // Bot faqat -1009999999 kanalida admin
  getChatMember: async (chatId: number) => {
    if (chatId !== -1009999999) throw new Error("chat not found");
    return { status: "administrator", can_invite_users: true };
  },
} as unknown as Api;

describe.skipIf(!enabled)("admin API", () => {
  let app: Express;
  let superToken = "";
  let adminToken = "";

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE activity_logs, broadcast_recipients, broadcasts, panel_users, bot_commands, bot_menu, messages, receipts, access_grants, orders, cards, products, users RESTART IDENTITY CASCADE`,
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
    expect(q.body.items.map((u: { firstName: string }) => u.firstName).sort()).toEqual(["Ali", "Vali"]);
    const blocked = await request(app).get("/api/telegram-users?status=blocked").set(auth);
    expect(blocked.body.total).toBe(1);
  });

  it("support username: faqat super admin o'zgartiradi, normalizatsiya va validatsiya", async () => {
    const auth = { Authorization: `Bearer ${superToken}` };
    const stored = async () => (await prisma.setting.findUnique({ where: { key: "support_username" } }))?.value;
    // Ruxsatsiz: tokensiz — 401, ADMIN roli — 403, baza o'zgarmaydi
    expect((await request(app).put("/api/bot/settings").send({ supportUsername: "hacker_x" })).status).toBe(401);
    const forbidden = await request(app).put("/api/bot/settings").set("Authorization", `Bearer ${adminToken}`).send({ supportUsername: "hacker_x" });
    expect(forbidden.status).toBe(403);
    expect(await stored()).not.toBe("hacker_x");

    for (const [input, expected] of [
      ["@new_support", "new_support"],
      ["new_support2", "new_support2"],
      ["https://t.me/new_support3", "new_support3"],
    ] as const) {
      expect((await request(app).put("/api/bot/settings").set(auth).send({ supportUsername: input })).status).toBe(200);
      expect(await stored()).toBe(expected);
      expect((await request(app).get("/api/bot/settings").set(auth)).body.supportUsername).toBe(expected);
    }

    const bad = await request(app).put("/api/bot/settings").set(auth).send({ supportUsername: "@new support" });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain("Telegram username noto'g'ri formatda.");
    expect(await stored()).toBe("new_support3");

    // Bo'sh qiymat — sozlama tozalanadi
    expect((await request(app).put("/api/bot/settings").set(auth).send({ supportUsername: "" })).status).toBe(200);
    expect((await request(app).get("/api/bot/settings").set(auth)).body.supportUsername).toBe("");
  });

  it("bot tugmalari: faqat super admin, noma'lum tugma rad etiladi, holat saqlanadi", async () => {
    const auth = { Authorization: `Bearer ${superToken}` };
    type Screens = { id: string; buttons: { id: string; enabled: boolean }[] }[];
    const enabled = (screens: Screens, id: string) => screens.flatMap((s) => s.buttons).find((b) => b.id === id)?.enabled;

    expect((await request(app).get("/api/bot/buttons")).status).toBe(401);
    const forbidden = await request(app).put("/api/bot/buttons").set("Authorization", `Bearer ${adminToken}`).send({ values: { "home.help": false } });
    expect(forbidden.status).toBe(403);

    const list = await request(app).get("/api/bot/buttons").set(auth);
    expect(list.status).toBe(200);
    expect(enabled(list.body.screens, "home.help")).toBe(true);
    expect(enabled(list.body.screens, "product.ask")).toBe(true);

    const off = await request(app).put("/api/bot/buttons").set(auth).send({ values: { "home.help": false } });
    expect(off.status).toBe(200);
    expect(enabled(off.body.screens, "home.help")).toBe(false);
    expect(enabled(off.body.screens, "product.ask")).toBe(true);
    expect(enabled((await request(app).get("/api/bot/buttons").set(auth)).body.screens, "home.help")).toBe(false);

    expect((await request(app).put("/api/bot/buttons").set(auth).send({ values: { "no.such": false } })).status).toBe(400);

    // Umumiy tugma boshqa ekranda standart holatda o'chiq — yoqsa bo'ladi; "reset" hammasini standartga qaytaradi
    expect(enabled(off.body.screens, "catalog.ask")).toBe(false);
    const added = await request(app).put("/api/bot/buttons").set(auth).send({ values: { "catalog.ask": true, "product.buy": false } });
    expect(enabled(added.body.screens, "catalog.ask")).toBe(true);
    expect(enabled(added.body.screens, "product.buy")).toBe(false);
    expect((await request(app).post("/api/bot/buttons/reset").set("Authorization", `Bearer ${adminToken}`)).status).toBe(403);
    const reset = await request(app).post("/api/bot/buttons/reset").set(auth);
    expect(enabled(reset.body.screens, "home.help")).toBe(true);
    expect(enabled(reset.body.screens, "catalog.ask")).toBe(false);
    expect(enabled(reset.body.screens, "product.buy")).toBe(true);
  });

  it("bot matnlari va kurs nomi limiti: faqat super admin, validatsiya, standartga qaytarish", async () => {
    const auth = { Authorization: `Bearer ${superToken}` };
    expect((await request(app).get("/api/bot/texts")).status).toBe(401);
    expect((await request(app).get("/api/bot/texts").set("Authorization", `Bearer ${adminToken}`)).status).toBe(403);
    expect((await request(app).put("/api/bot/texts").set("Authorization", `Bearer ${adminToken}`).send({ lang: "uz", values: {} })).status).toBe(403);

    const initial = await request(app).get("/api/bot/texts?lang=uz").set(auth);
    type Item = { key: string; value: string; default: string; group: string; vars: string[]; overridden: boolean; disabled: boolean };
    const item = (body: { items: Item[] }, key: string) => body.items.find((i) => i.key === key)!;
    expect(item(initial.body, "payment_expires").value).toBe("⏳ Buyurtma {expires_at} gacha amal qiladi.");
    expect(item(initial.body, "help").group).toBe("help");
    // Tugma yozuvlari ro'yxatda yo'q (ular faqat koddan o'zgaradi)
    expect(initial.body.items.some((i: Item) => i.key.startsWith("btn_") || i.key.startsWith("menu_"))).toBe(false);

    const ok = await request(app)
      .put("/api/bot/texts")
      .set(auth)
      .send({
        lang: "uz",
        values: {
          intro_video_text: "{mahsulot}: yangi matn 👇",
          payment_step_1: "1️⃣ {summa} ni {karta} ga o'tkazing ({mahsulot}, #{raqam}, {karta_egasi}).",
          payment_expires: "⏳ {expires_at} gacha",
        },
      });
    expect(ok.status).toBe(200);
    expect(item(ok.body, "intro_video_text")).toMatchObject({ value: "{mahsulot}: yangi matn 👇", overridden: true });
    // Kod uzatadigan, lekin standart matnda yo'q o'zgaruvchilar ham ruxsat etilgan
    expect(item(ok.body, "payment_step_1").vars).toEqual(expect.arrayContaining(["summa", "karta", "mahsulot", "raqam", "karta_egasi"]));
    expect(await prisma.text.findUnique({ where: { key_lang: { key: "payment_expires", lang: "uz" } } })).toMatchObject({ body: "⏳ {expires_at} gacha" });

    for (const values of [{ payment_step_2: "<b>yopilmagan" }, { boshqa_kalit: "x" }, { btn_buy: "x" }, { help: "{noma_lum}" }, { error_stale_button: "<b>x</b>" }]) {
      expect((await request(app).put("/api/bot/texts").set(auth).send({ lang: "uz", values })).status).toBe(400);
    }
    expect((await request(app).put("/api/bot/texts").set(auth).send({ lang: "de", values: {} })).status).toBe(400);

    // Bo'sh matn ruxsat etilgan — xabar qismi o'chiriladi; majburiy o'zgaruvchisiz umumiy matn ham saqlanadi
    const blank = await request(app).put("/api/bot/texts").set(auth).send({ lang: "uz", values: { payment_step_1: "   ", payment_expires: "⏳ Muddat cheklangan" } });
    expect(blank.status).toBe(200);
    expect(item(blank.body, "payment_step_1")).toMatchObject({ value: "", overridden: true, disabled: false });
    expect(item(blank.body, "payment_expires").value).toBe("⏳ Muddat cheklangan");

    // Yoqish/o'chirish: matn saqlanib qoladi; bo'sh matn yoqilsa — standartga qaytadi
    expect((await request(app).put("/api/bot/texts").set(auth).send({ lang: "uz", enabled: { btn_buy: false } })).status).toBe(400);
    const off = await request(app).put("/api/bot/texts").set(auth).send({ lang: "uz", enabled: { help: false } });
    expect(item(off.body, "help")).toMatchObject({ disabled: true, value: item(initial.body, "help").value });
    expect((await request(app).get("/api/bot/texts?lang=ru").set(auth)).body.items.find((i: Item) => i.key === "help").disabled).toBe(true);
    const on = await request(app).put("/api/bot/texts").set(auth).send({ lang: "uz", enabled: { help: true, payment_step_1: true } });
    expect(item(on.body, "help").disabled).toBe(false);
    expect(item(on.body, "payment_step_1")).toMatchObject({ value: item(initial.body, "payment_step_1").default, overridden: false });

    // Standart matn saqlansa — override o'chiriladi
    await request(app).put("/api/bot/texts").set(auth).send({ lang: "uz", values: { payment_expires: item(initial.body, "payment_expires").default } });
    expect(await prisma.text.findUnique({ where: { key_lang: { key: "payment_expires", lang: "uz" } } })).toBeNull();

    for (const bad of [0, -1, 101, 7.5, "7"]) {
      expect((await request(app).put("/api/bot/settings").set(auth).send({ courseNameMaxLength: bad })).status).toBe(400);
    }
    expect((await request(app).put("/api/bot/settings").set(auth).send({ courseNameMaxLength: 7 })).status).toBe(200);
    expect((await request(app).get("/api/bot/settings").set(auth)).body.courseNameMaxLength).toBe(7);
    await prisma.text.deleteMany();
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

  it("media broadcast: fayl oldindan saqlash chatiga yuklanadi, qabul qiluvchilarga file_id ketadi", async () => {
    const auth = { Authorization: `Bearer ${superToken}` };
    await prisma.setting.upsert({ where: { key: "admin_group_id" }, create: { key: "admin_group_id", value: "-100777" }, update: { value: "-100777" } });
    invalidateSettings();
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const res = await request(app)
      .post("/api/broadcast")
      .set(auth)
      .field({ messageType: "photo", text: "Rasm", audience: "all", idempotencyKey: "22222222-2222-4222-8222-222222222222" })
      .attach("file", png, { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    const id = res.body.broadcast.id as number;
    for (let i = 0; i < 50; i++) {
      if ((await prisma.broadcast.findUniqueOrThrow({ where: { id } })).status === "completed") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(await prisma.broadcast.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "completed", fileId: "stored-photo" });
    expect(photoCalls[0]).toEqual({ chatId: -100777, byFileId: false });
    expect(photoCalls.slice(1).every((c) => c.byFileId && c.chatId > 0)).toBe(true);
    await prisma.setting.delete({ where: { key: "admin_group_id" } });
    invalidateSettings();
  });

  it("panel admini Telegram ID bilan — botda ham admin (rol, ID almashishi, bloklash, o'chirish sinxron)", async () => {
    const auth = { Authorization: `Bearer ${superToken}` };
    const bot = (id: bigint) => prisma.admin.findUnique({ where: { telegramId: id } });
    const base = { email: "tg@test.uz", name: "Telegramli", password: "tgpass123", role: "admin" };

    expect((await request(app).post("/api/admins").set(auth).send({ ...base, telegramId: "12ab" })).status).toBe(400);
    sent.length = 0;
    const created = await request(app).post("/api/admins").set(auth).send({ ...base, telegramId: "700700700" });
    expect(created.status).toBe(201);
    expect(await bot(700700700n)).toMatchObject({ role: "admin", isActive: true, name: "Telegramli" });
    expect(sent).toContain(700700700); // botda "admin huquqi berildi" xabari

    // Boshqa panel admini xuddi shu ID ni ololmaydi
    expect((await request(app).post("/api/admins").set(auth).send({ ...base, email: "tg2@test.uz", telegramId: "700700700" })).status).toBe(409);

    const id = created.body.id as number;
    await request(app).put(`/api/admins/${id}`).set(auth).send({ role: "superadmin" });
    expect((await bot(700700700n))?.role).toBe("superadmin");

    const list = await request(app).get("/api/admins").set(auth);
    expect(list.body.items.find((u: { id: number }) => u.id === id)).toMatchObject({ telegramId: "700700700", bot: { role: "superadmin" } });

    // ID almashtirildi — eski hisobdan huquq olinadi, yangisiga beriladi
    await request(app).put(`/api/admins/${id}`).set(auth).send({ telegramId: "700700701" });
    expect((await bot(700700700n))?.isActive).toBe(false);
    expect(await bot(700700701n)).toMatchObject({ role: "superadmin", isActive: true });

    await request(app).put(`/api/admins/${id}`).set(auth).send({ isActive: false });
    expect((await bot(700700701n))?.isActive).toBe(false);
    await request(app).put(`/api/admins/${id}`).set(auth).send({ isActive: true });
    expect((await bot(700700701n))?.isActive).toBe(true);

    // ID olib tashlansa — botdagi huquq ham olinadi
    await request(app).put(`/api/admins/${id}`).set(auth).send({ telegramId: null });
    expect((await bot(700700701n))?.isActive).toBe(false);

    await request(app).put(`/api/admins/${id}`).set(auth).send({ telegramId: "700700702" });
    expect((await request(app).delete(`/api/admins/${id}`).set(auth)).status).toBe(204);
    expect((await bot(700700702n))?.isActive).toBe(false);
  });

  it("oxirgi super adminni o'chirib bo'lmaydi; harakatlar loglanadi", async () => {
    const auth = { Authorization: `Bearer ${superToken}` };
    expect((await request(app).delete("/api/admins/1").set(auth)).status).toBe(400);
    const logs = await request(app).get("/api/activity-logs?pageSize=100").set(auth);
    const actions = logs.body.items.map((l: { action: string }) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["LOGIN", "LOGIN_FAILED", "CREATE_BROADCAST"]));
  });

  it("chekni paneldan tasdiqlash: mijozga link, ikkinchi marta — 409", async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const product = await prisma.product.create({ data: { code: "4b", title: "4 bosqichli", price: 1000, channelId: -1001n } });
    const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: 1001n } });
    const order = await prisma.order.create({
      data: { userId: user.id, productId: product.id, amount: 1000, status: "receipt_sent", attempts: 1, expiresAt: new Date(Date.now() + 3600_000) },
    });
    const before = sent.length;
    const res = await request(app).post(`/api/orders/${order.id}/approve`).set(auth);
    expect(res.status).toBe(200);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(saved.status).toBe("approved");
    expect(saved.reviewedByPanelId).toBe(2);
    expect(sent.slice(before)).toEqual([1001]);
    expect(await prisma.accessGrant.count({ where: { orderId: order.id } })).toBe(1);
    expect((await request(app).post(`/api/orders/${order.id}/approve`).set(auth)).status).toBe(409);
  });

  it("chekni paneldan rad etish: 'Summa kam' summasiz — 400, summa bilan — rejected", async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const product = await prisma.product.findUniqueOrThrow({ where: { code: "4b" } });
    const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: 1002n } });
    await prisma.user.update({ where: { id: user.id }, data: { isBlocked: false } });
    const order = await prisma.order.create({
      data: { userId: user.id, productId: product.id, amount: 1000, status: "receipt_sent", attempts: 1, expiresAt: new Date(Date.now() + 3600_000) },
    });
    expect((await request(app).post(`/api/orders/${order.id}/reject`).set(auth).send({ reason: "short" })).status).toBe(400);
    const res = await request(app).post(`/api/orders/${order.id}/reject`).set(auth).send({ reason: "short", amount: 300 });
    expect(res.status).toBe(200);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(saved).toMatchObject({ status: "rejected", shortfall: 300 });
    const count = await request(app).get("/api/orders/pending-count").set(auth);
    expect(count.body.count).toBe(0);
  });

  it("kartalar va mahsulotlar — faqat SUPER_ADMIN; karta raqami tekshiriladi", async () => {
    expect((await request(app).get("/api/cards").set({ Authorization: `Bearer ${adminToken}` })).status).toBe(403);
    const auth = { Authorization: `Bearer ${superToken}` };
    expect((await request(app).post("/api/cards").set(auth).send({ number: "1234", holder: "Test" })).status).toBe(400);
    const card = await request(app).post("/api/cards").set(auth).send({ number: "8600 1234 5678 9012", holder: "Aziz Karimov" });
    expect(card.status).toBe(201);
    expect(card.body.numberMasked).toBe("8600 **** **** 9012");
    const product = await prisma.product.findUniqueOrThrow({ where: { code: "4b" } });
    const upd = await request(app).put(`/api/products/${product.id}`).set(auth).send({ price: 1250000, description: "Yangi" });
    expect(upd.body.price).toBe(1250000);
  });

  it("mahsulot qo'shish va o'chirish: kod tekshiriladi, buyurtmasi bor mahsulot tarixi saqlangan holda o'chiriladi", async () => {
    const auth = { Authorization: `Bearer ${superToken}` };
    const admin = { Authorization: `Bearer ${adminToken}` };
    const base = { title: "5 bosqichli", price: 900000, type: "channel" };
    expect((await request(app).post("/api/products").set(admin).send({ ...base, code: "5b" })).status).toBe(403);
    // "_" deeplink ajratgichi — kodda mumkin emas
    expect((await request(app).post("/api/products").set(auth).send({ ...base, code: "5_b" })).status).toBe(400);
    expect((await request(app).post("/api/products").set(auth).send({ ...base, code: "4b" })).status).toBe(409);
    // Bot admin bo'lmagan kanal
    expect((await request(app).post("/api/products").set(auth).send({ ...base, code: "5b", channelId: "-1001111111" })).status).toBe(400);

    const created = await request(app).post("/api/products").set(auth).send({ ...base, code: "5B", channelId: "-1009999999" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: "5b", channelId: "-1009999999", isActive: false, type: "channel" });

    // To'plam: kamida 2 ta mavjud kanalli mahsulot
    const bundle = { title: "To'plam", price: 1500000, type: "bundle", code: "set" };
    expect((await request(app).post("/api/products").set(auth).send({ ...bundle, bundleCodes: ["5b", "yoq"] })).status).toBe(400);
    const set = await request(app).post("/api/products").set(auth).send({ ...bundle, bundleCodes: ["5b", "4b"] });
    expect(set.status).toBe(201);
    expect(set.body.bundleCodes).toEqual(["5b", "4b"]);

    // To'plam tarkibidagi mahsulot o'chirilmaydi; avval to'plam
    expect((await request(app).delete(`/api/products/${created.body.id}`).set(auth)).status).toBe(409);
    expect((await request(app).delete(`/api/products/${set.body.id}`).set(auth)).status).toBe(200);
    expect((await request(app).delete(`/api/products/${created.body.id}`).set(auth)).status).toBe(200);
    expect(await prisma.product.findUnique({ where: { code: "5b" } })).toBeNull();

    // Buyurtmasi bor mahsulot — "yumshoq" o'chiriladi: tarix va to'langan buyurtma saqlanadi,
    // to'lanmagan ochiq buyurtma bekor qilinadi, kod bo'shaydi, ro'yxatdan yo'qoladi
    const [buyer, other] = await prisma.user.findMany({ take: 2, orderBy: { id: "asc" } });
    const old = await prisma.product.create({ data: { code: "eski", title: "Eski kurs", price: 1000, isActive: true } });
    const expiresAt = new Date(Date.now() + 86400_000);
    const paid = await prisma.order.create({ data: { userId: buyer.id, productId: old.id, amount: 1000, status: "approved", paidAt: new Date(), expiresAt } });
    const unpaid = await prisma.order.create({ data: { userId: buyer.id, productId: old.id, amount: 1000, status: "new", expiresAt } });
    const reviewing = await prisma.order.create({ data: { userId: other.id, productId: old.id, amount: 1000, status: "receipt_sent", expiresAt } });
    // Chek tekshirilayotgan bo'lsa — avval ko'rib chiqish kerak
    const blocked = await request(app).delete(`/api/products/${old.id}`).set(auth);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toContain("tekshirilmoqda");
    await prisma.order.update({ where: { id: reviewing.id }, data: { status: "rejected" } });

    expect((await request(app).delete(`/api/products/${old.id}`).set(auth)).status).toBe(200);
    const gone = await prisma.product.findUniqueOrThrow({ where: { id: old.id } });
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.isActive).toBe(false);
    expect(gone.code).not.toBe("eski");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe("approved");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: unpaid.id } })).status).toBe("cancelled");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: reviewing.id } })).status).toBe("cancelled");
    const listed = await request(app).get("/api/products").set(auth);
    expect(listed.body.items.some((p: { id: number }) => p.id === old.id)).toBe(false);
    expect((await request(app).put(`/api/products/${old.id}`).set(auth).send({ isActive: true })).status).toBe(404);
    expect((await request(app).delete(`/api/products/${old.id}`).set(auth)).status).toBe(404);

    const logs = await prisma.activityLog.findMany({ where: { action: { in: ["CREATE_PRODUCT", "DELETE_PRODUCT"] } } });
    expect(logs).toHaveLength(5);
  });
  it("foydalanuvchini cheklash/tiklash: ro'yxatda ko'rinadi, broadcastdan chiqariladi, loglanadi", async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const vali = await prisma.user.findUniqueOrThrow({ where: { telegramId: 1002n } });
    const before = (await request(app).get("/api/broadcast/recipients-count?audience=all").set(auth)).body.count;

    const ban = await request(app).post(`/api/telegram-users/${vali.id}/ban`).set(auth);
    expect(ban.status).toBe(200);
    expect(ban.body.isBanned).toBe(true);
    expect((await request(app).get("/api/telegram-users?status=banned").set(auth)).body.total).toBe(1);
    expect((await request(app).get("/api/broadcast/recipients-count?audience=all").set(auth)).body.count).toBe(before - 1);

    expect((await request(app).post(`/api/telegram-users/${vali.id}/unban`).set(auth)).body.isBanned).toBe(false);
    expect((await request(app).post("/api/telegram-users/999999/ban").set(auth)).status).toBe(404);
    const logs = await prisma.activityLog.findMany({ where: { action: { in: ["BAN_USER", "UNBAN_USER"] } } });
    expect(logs).toHaveLength(2);
  });

  it("foydalanuvchiga xabar: yuboriladi va bildirishnoma sifatida saqlanadi", async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const ali = await prisma.user.findUniqueOrThrow({ where: { telegramId: 1001n } });
    expect((await request(app).post(`/api/telegram-users/${ali.id}/message`).set(auth).send({ text: "  " })).status).toBe(400);
    const before = sent.length;
    const res = await request(app).post(`/api/telegram-users/${ali.id}/message`).set(auth).send({ text: "Salom <b>" });
    expect(res.body.delivered).toBe(true);
    expect(sent.slice(before)).toEqual([1001]);
    // Chek tasdiqlanganda ham bildirishnoma yozilgan ("success") — bu test faqat admin xabarini tekshiradi
    expect(await prisma.notification.count({ where: { userId: ali.id, kind: "success" } })).toBe(1);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: ali.id, kind: "message" } });
    expect(n.delivered).toBe(true);
    // Admin matni HTML sifatida emas, oddiy matn sifatida boradi
    expect(n.text).toContain("Salom &lt;b&gt;");
  });

  it("broadcast auditoriyalari: xaridorlar, xarid qilmaganlar, mahsulot egalari, adminlar; yangiliklardan voz kechganlar", async () => {
    const auth = { Authorization: `Bearer ${superToken}` };
    const count = async (qs: string) => (await request(app).get(`/api/broadcast/recipients-count?${qs}`).set(auth)).body.count as number;
    const product = await prisma.product.findUniqueOrThrow({ where: { code: "4b" } });

    // Ali — tasdiqlangan xaridi bor (yuqoridagi test), Vali — yo'q
    expect(await count("audience=buyers")).toBe(1);
    expect(await count("audience=non_buyers")).toBe(1);
    expect(await count(`audience=product&productId=${product.id}`)).toBe(1);
    expect((await request(app).get("/api/broadcast/recipients-count?audience=product").set(auth)).status).toBe(400);

    await prisma.admin.upsert({ where: { telegramId: 1001n }, create: { telegramId: 1001n }, update: { isActive: true } });
    expect(await count("audience=admins")).toBe(1);

    await prisma.user.update({ where: { telegramId: 1002n }, data: { newsEnabled: false } });
    expect(await count("audience=non_buyers")).toBe(0);
    // Nomma-nom tanlanganda yangiliklar sozlamasi hisobga olinmaydi
    expect(await count("audience=specific&recipients=1002")).toBe(1);
  });

  it("ADMIN mahsulot va kartalarga kira olmaydi, foydalanuvchilarni boshqara oladi", async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    expect((await request(app).get("/api/products").set(auth)).status).toBe(403);
    const ali = await prisma.user.findUniqueOrThrow({ where: { telegramId: 1001n } });
    expect((await request(app).post(`/api/telegram-users/${ali.id}/ban`).set(auth)).status).toBe(200);
    await request(app).post(`/api/telegram-users/${ali.id}/unban`).set(auth);
  });

  it("cheklar tarixi: tasdiqlangan va rad etilganlar, filtr va qidiruv; buyurtmani bekor qilish", async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const product = await prisma.product.create({ data: { code: "tarix", title: "Tarix kursi", price: 5000, channelId: -1002n } });
    const ali = await prisma.user.findUniqueOrThrow({ where: { telegramId: 1001n } });
    const vali = await prisma.user.findUniqueOrThrow({ where: { telegramId: 1002n } });
    const expiresAt = new Date(Date.now() + 3600_000);
    const withReceipt = async (userId: bigint, n: number) =>
      prisma.order.create({
        data: {
          userId,
          productId: product.id,
          amount: 5000,
          status: "receipt_sent",
          attempts: 1,
          expiresAt,
          receipts: { create: { fileId: `f${n}`, fileUniqueId: `u${n}`, fileType: "photo" } },
        },
      });
    const a = await withReceipt(ali.id, 1);
    const b = await withReceipt(vali.id, 2);
    // Tekshirilayotgan chek tarixda emas
    expect((await request(app).get("/api/orders/receipts/history").set(auth)).body.items.some((o: { id: string }) => o.id === String(a.id))).toBe(false);

    expect((await request(app).post(`/api/orders/${a.id}/approve`).set(auth)).status).toBe(200);
    expect((await request(app).post(`/api/orders/${b.id}/reject`).set(auth).send({ reason: "short", amount: 100 })).status).toBe(200);

    const history = async (qs = "") => (await request(app).get(`/api/orders/receipts/history?${qs}`).set(auth)).body;
    const ids = (body: { items: { id: string }[] }) => body.items.map((o) => o.id);
    expect(ids(await history())).toEqual(expect.arrayContaining([String(a.id), String(b.id)]));
    expect(ids(await history("result=approved"))).toContain(String(a.id));
    expect(ids(await history("result=approved"))).not.toContain(String(b.id));
    expect(ids(await history("result=rejected"))).toEqual([String(b.id)]);
    expect(ids(await history("q=Vali"))).toEqual([String(b.id)]);
    expect(ids(await history(`q=%23${a.id}`))).toEqual([String(a.id)]);
    expect((await history()).items.find((o: { id: string }) => o.id === String(a.id)).reviewedByPanel.name).toBe("Admin");

    // Ochiq (rad etilgan) buyurtma — "Bekor qilingan", mijozga sabab bilan xabar
    let before = sent.length;
    const c1 = await request(app).post(`/api/orders/${b.id}/cancel`).set(auth).send({ reason: "Mijoz so'radi" });
    expect(c1.status).toBe(200);
    expect(c1.body).toMatchObject({ ok: true, status: "cancelled", revoked: 0 });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "cancelled", cancelledById: 2, cancelReason: "Mijoz so'radi" });
    expect(sent.slice(before)).toEqual([1002]);
    expect(ids(await history("result=cancelled"))).toEqual([String(b.id)]);
    expect(ids(await history("result=rejected"))).toEqual([]);

    // To'langan buyurtma — "Pul qaytarilgan", mijoz kanaldan chiqariladi
    before = sent.length;
    const kickedBefore = kicked.length;
    const c2 = await request(app).post(`/api/orders/${a.id}/cancel`).set(auth).send({});
    expect(c2.status).toBe(200);
    expect(c2.body).toMatchObject({ status: "refunded", revoked: 1 });
    expect(kicked.slice(kickedBefore)).toEqual([1001]);
    const grant = await prisma.accessGrant.findFirstOrThrow({ where: { orderId: a.id } });
    expect(grant.revokedAt).not.toBeNull();
    expect(sent.slice(before)).toEqual([1001]);

    // Yopilgan buyurtma qayta bekor qilinmaydi; mavjud bo'lmagani — 404
    expect((await request(app).post(`/api/orders/${a.id}/cancel`).set(auth).send({})).status).toBe(409);
    expect((await request(app).post(`/api/orders/999999/cancel`).set(auth).send({})).status).toBe(404);
    const logs = await prisma.activityLog.count({ where: { action: "CANCEL_ORDER" } });
    expect(logs).toBe(2);
  });

  it("xatoliklar: bir xil xato guruhlanadi, hal qilinadi, takrorlansa qayta ochiladi; faqat super admin", async () => {
    await prisma.errorLog.deleteMany();
    const auth = { Authorization: `Bearer ${superToken}` };
    const log = (msg: string, errMessage: string) =>
      errorSinkStream.write(
        JSON.stringify({ level: 50, time: new Date().toISOString(), msg, err: { type: "Error", message: errMessage, stack: `Error: ${errMessage}\n    at x` }, token: "***" }),
      );
    // Raqamlar farq qilsa ham — bitta guruh
    log("bot xatosi", "chat 123 not found");
    log("bot xatosi", "chat 456 not found");
    log("API xatosi", "boshqa xato");
    // info darajasidagi yozuv yig'ilmaydi
    errorSinkStream.write(JSON.stringify({ level: 30, msg: "oddiy log" }));
    await flushErrorLogs();

    expect((await request(app).get("/api/errors").set({ Authorization: `Bearer ${adminToken}` })).status).toBe(403);
    const list = await request(app).get("/api/errors").set(auth);
    expect(list.status).toBe(200);
    expect(list.body.counts).toEqual({ open: 2, resolved: 0 });
    const bot = list.body.items.find((e: { message: string }) => e.message === "bot xatosi");
    expect(bot).toMatchObject({ count: 2, errorType: "Error", errorText: "chat 456 not found" });
    expect(bot.stack).toBeUndefined();

    const detail = await request(app).get(`/api/errors/${bot.id}`).set(auth);
    expect(detail.body.stack).toContain("at x");
    expect(detail.body.context).toEqual({ token: "***" });

    expect((await request(app).post(`/api/errors/${bot.id}/resolve`).set(auth)).status).toBe(200);
    expect((await request(app).get("/api/errors/count").set(auth)).body.open).toBe(1);
    expect((await request(app).get("/api/errors?status=resolved").set(auth)).body.items).toHaveLength(1);

    // Takrorlandi — yana ochiq, son oshadi
    log("bot xatosi", "chat 789 not found");
    await flushErrorLogs();
    const again = await prisma.errorLog.findUniqueOrThrow({ where: { id: BigInt(bot.id) } });
    expect(again).toMatchObject({ count: 3, resolvedAt: null });

    expect((await request(app).get("/api/errors?q=boshqa").set(auth)).body.items).toHaveLength(1);
    expect((await request(app).post("/api/errors/resolve-all").set(auth)).body.count).toBe(2);
    expect((await request(app).delete("/api/errors/resolved").set(auth)).body.count).toBe(2);
    expect(await prisma.errorLog.count()).toBe(0);
  });
});
