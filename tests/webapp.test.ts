import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Api } from "grammy";
import type { Express } from "express";
import { prisma } from "../src/db";
import { createApp } from "../src/api/app";
import { signInitData } from "../src/lib/telegramAuth";
import { addCard } from "../src/services/cards";
import { createPanelUser } from "../src/services/panelUsers";
import { invalidateSettings, setSetting } from "../src/services/settings";

const enabled = !!process.env.TEST_DATABASE_URL;
const TOKEN = "777:webapp-test-token";

// Soxta Telegram API: fayl yuklash file_id qaytaradi, xabarlar yoziladi
const sentTo: number[] = [];
let seq = 0;
const fakeApi = {
  token: TOKEN,
  getMe: async () => ({ id: 42, is_bot: true, first_name: "Test", username: "test_bot" }),
  sendMessage: async (chatId: number) => {
    sentTo.push(chatId);
    return { message_id: ++seq, chat: { id: chatId } };
  },
  sendPhoto: async (chatId: number) => {
    sentTo.push(chatId);
    return { message_id: ++seq, chat: { id: chatId }, photo: [{ file_id: `ph-${seq}`, file_unique_id: `u-${seq}`, width: 1, height: 1 }] };
  },
  sendDocument: async (chatId: number) => ({ message_id: ++seq, chat: { id: chatId }, document: { file_id: `doc-${seq}`, file_unique_id: `ud-${seq}` } }),
  sendVideo: async (chatId: number) => {
    sentTo.push(chatId);
    return { message_id: ++seq };
  },
  createChatInviteLink: async () => ({ invite_link: `https://t.me/+w${++seq}` }),
  revokeChatInviteLink: async () => true,
  editMessageCaption: async () => true,
  editMessageText: async () => true,
  // Faqat 777 ID li foydalanuvchida profil rasmi bor
  getUserProfilePhotos: async (userId: number) => ({
    total_count: userId === 777 ? 1 : 0,
    photos: userId === 777 ? [[{ file_id: "pic-s", file_unique_id: "ps", width: 160, height: 160 }]] : [],
  }),
  getFile: async (fileId: string) => ({ file_id: fileId, file_unique_id: "f", file_path: "photos/file_1.jpg" }),
} as unknown as Api;

// Haqiqiy PNG sarlavhasi (magic bytes) — server fayl turini mazmunidan aniqlaydi
const PNG = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex");

const tgUser = (id: number, extra: Record<string, unknown> = {}) => JSON.stringify({ id, first_name: "Aziz", username: "aziz", language_code: "uz", ...extra });
const initData = (id: number, authDate = Math.floor(Date.now() / 1000)) =>
  signInitData({ auth_date: String(authDate), query_id: "q1", user: tgUser(id) }, TOKEN);

describe.skipIf(!enabled)("Telegram Mini App API", () => {
  let app: Express;
  let token = "";
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE notifications, activity_logs, broadcast_recipients, broadcasts, panel_users, events, audit_log, messages, receipts, access_grants, orders, cards, products, admins, settings, users RESTART IDENTITY CASCADE`,
    );
    invalidateSettings();
    await prisma.product.createMany({
      data: [
        { code: "4b", title: "4 bosqichli", price: 1_250_000, channelId: -1001n, sortOrder: 1, videoFileId: "vid-1" },
        { code: "qd", title: "Qoidalar", price: 800_000, channelId: -1002n, sortOrder: 2 },
      ],
    });
    await addCard("8600123412341234", "A. Karimov");
    app = createApp({ runtime: { api: fakeApi, mode: "polling", tokenSource: "env", isRunning: () => true } });
  });
  afterAll(() => prisma.$disconnect());

  it("initData: imzosiz, soxta va eskirgan ma'lumot rad etiladi", async () => {
    const post = (data: string) => request(app).post("/api/app/auth/telegram").send({ initData: data });
    expect((await post("user=%7B%22id%22%3A1%7D&auth_date=1")).status).toBe(401);
    // Boshqa token bilan imzolangan
    expect((await post(signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: tgUser(5001) }, "1:other"))).status).toBe(401);
    // Imzodan keyin o'zgartirilgan (boshqa ID)
    expect((await post(initData(5001).replace("5001", "5002"))).status).toBe(401);
    // 2 kun oldingi
    const old = await post(initData(5001, Math.floor(Date.now() / 1000) - 2 * 86400));
    expect(old.status).toBe(401);
    expect(old.body.details.code).toBe("invalid_init_data");
    expect(await prisma.user.count()).toBe(0);
  });

  it("kirish: foydalanuvchi yaratiladi, token va profil qaytadi", async () => {
    const res = await request(app).post("/api/app/auth/telegram").send({ initData: initData(5001) });
    expect(res.status).toBe(200);
    token = res.body.token;
    expect(res.body.me).toMatchObject({ role: "user", lang: "uz", user: { telegramId: "5001", firstName: "Aziz", phone: null } });
    expect(res.body.me.permissions).toEqual(["catalog.view", "profile.view", "help.view"]);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });

  it("Mini App tokeni va panel tokeni bir-birining o'rnida ishlamaydi", async () => {
    expect((await request(app).get("/api/dashboard/stats").set(auth())).status).toBe(401);
    await createPanelUser({ email: "s@test.uz", name: "S", password: "superpass1", role: "superadmin" });
    const panelToken = (await request(app).post("/api/auth/login").send({ email: "s@test.uz", password: "superpass1" })).body.token;
    expect((await request(app).get("/api/app/me").set({ Authorization: `Bearer ${panelToken}` })).status).toBe(401);
    expect((await request(app).get("/api/app/me")).status).toBe(401);
    expect((await request(app).get("/api/app/nimadir").set(auth())).status).toBe(404);
  });

  it("katalog, telefon talabi, buyurtma (ikki marta — bitta), sozlamalar", async () => {
    const products = await request(app).get("/api/app/products").set(auth());
    expect(products.body.items.map((p: { code: string; ownership: string }) => [p.code, p.ownership])).toEqual([["4b", "none"], ["qd", "none"]]);
    expect(JSON.stringify(products.body)).not.toContain("vid-1");

    const noPhone = await request(app).post("/api/app/orders").set(auth()).send({ productCode: "4b" });
    expect(noPhone.status).toBe(409);
    expect(noPhone.body.details.code).toBe("phone_required");

    await prisma.user.update({ where: { telegramId: 5001n }, data: { phone: "+998901234567" } });
    const first = await request(app).post("/api/app/orders").set(auth()).send({ productCode: "4b" });
    const second = await request(app).post("/api/app/orders").set(auth()).send({ productCode: "4b" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    const detail = await request(app).get(`/api/app/orders/${first.body.id}`).set(auth());
    expect(detail.body).toMatchObject({ status: "new", amount: 1_250_000, canCancel: true, card: { number: "8600123412341234" } });

    const settings = await request(app).patch("/api/app/me/settings").set(auth()).send({ language: "ru", newsEnabled: false });
    expect(settings.body).toMatchObject({ lang: "ru", user: { language: "ru", newsEnabled: false } });
    expect((await request(app).patch("/api/app/me/settings").set(auth()).send({ language: "de" })).status).toBe(400);
  });

  it("boshqa foydalanuvchi buyurtmani ko'ra, bekor qila, chek yubora olmaydi", async () => {
    const order = await prisma.order.findFirstOrThrow();
    const other = (await request(app).post("/api/app/auth/telegram").send({ initData: initData(6001) })).body.token as string;
    const h = { Authorization: `Bearer ${other}` };
    expect((await request(app).get(`/api/app/orders/${order.id}`).set(h)).status).toBe(404);
    expect((await request(app).post(`/api/app/orders/${order.id}/cancel`).set(h)).status).toBe(409);
    expect((await request(app).post(`/api/app/orders/${order.id}/receipt`).set(h).attach("file", PNG, { filename: "c.png", contentType: "image/png" })).status).toBe(404);
  });

  it("chek yuklash: noto'g'ri tur rad etiladi, rasm qabul qilinadi, ikkinchisi — tekshirilmoqda", async () => {
    const order = await prisma.order.findFirstOrThrow();
    const url = `/api/app/orders/${order.id}/receipt`;
    expect((await request(app).post(url).set(auth()).attach("file", Buffer.from("x"), { filename: "a.txt", contentType: "text/plain" })).status).toBe(400);
    // Content-Type soxta: "image/png" deb yuborilgan HTML — mazmuni bo'yicha rad etiladi
    const spoof = await request(app).post(url).set(auth()).attach("file", Buffer.from("<html><script>alert(1)</script></html>"), { filename: "chek.png", contentType: "image/png" });
    expect(spoof.status).toBe(400);
    expect(spoof.body.details.code).toBe("file_type");
    expect((await request(app).post(url).set(auth())).status).toBe(400);

    const ok = await request(app).post(url).set(auth()).attach("file", PNG, { filename: "chek.png", contentType: "image/png" });
    expect(ok.status).toBe(201);
    expect(sentTo).toContain(5001);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { receipts: true } });
    expect(saved).toMatchObject({ status: "receipt_sent", attempts: 1 });
    expect(saved.receipts[0].fileType).toBe("photo");

    const again = await request(app).post(url).set(auth()).attach("file", PNG, { filename: "chek.png", contentType: "image/png" });
    expect(again.status).toBe(409);
    expect(again.body.details.code).toBe("under_review");
  });

  it("admin: oddiy foydalanuvchiga yopiq; admin chekni ko'radi va tasdiqlaydi; mijozda xarid paydo bo'ladi", async () => {
    expect((await request(app).get("/api/app/admin/stats").set(auth())).status).toBe(403);

    await prisma.admin.create({ data: { telegramId: 9001n, role: "admin", name: "Admin" } });
    const adminToken = (await request(app).post("/api/app/auth/telegram").send({ initData: initData(9001) })).body;
    expect(adminToken.me.role).toBe("admin");
    const h = { Authorization: `Bearer ${adminToken.token}` };

    expect((await request(app).get("/api/app/admin/stats").set(h)).body.sales.pendingReceipts).toBe(1);
    const receipts = await request(app).get("/api/app/admin/receipts").set(h);
    expect(receipts.body.items).toHaveLength(1);
    const orderId = receipts.body.items[0].orderId as string;

    expect((await request(app).post(`/api/app/admin/orders/${orderId}/reject`).set(h).send({ reason: "short" })).status).toBe(400);
    expect((await request(app).post(`/api/app/admin/orders/${orderId}/approve`).set(h)).status).toBe(200);
    expect((await request(app).post(`/api/app/admin/orders/${orderId}/approve`).set(h)).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: "approve" } })).toBe(1);

    const purchases = await request(app).get("/api/app/purchases").set(auth());
    expect(purchases.body.items).toHaveLength(1);
    const link = await request(app).post(`/api/app/purchases/${purchases.body.items[0].id}/link`).set(auth());
    expect(link.body.url).toMatch(/^https:\/\/t\.me\/\+/);

    const notifications = await request(app).get("/api/app/notifications").set(auth());
    expect(notifications.body.items[0]).toMatchObject({ kind: "success" });
    expect(notifications.body.items[0].text).not.toContain("<b>");

    const products = await request(app).get("/api/app/products").set(auth());
    expect(products.body.items[0].ownership).toBe("owned");
  });

  it("buyurtmani bekor qilish: faqat to'lov kutilayotganda", async () => {
    const created = await request(app).post("/api/app/orders").set(auth()).send({ productCode: "qd" });
    expect((await request(app).post(`/api/app/orders/${created.body.id}/cancel`).set(auth())).status).toBe(200);
    expect((await request(app).post(`/api/app/orders/${created.body.id}/cancel`).set(auth())).status).toBe(409);
    const list = await request(app).get("/api/app/orders").set(auth());
    expect(list.body.items.map((o: { status: string }) => o.status)).toEqual(["cancelled", "approved"]);
  });

  it("cheklangan foydalanuvchi — 403, texnik xizmat — 503 (admin ishlaydi)", async () => {
    await prisma.user.update({ where: { telegramId: 5001n }, data: { isBanned: true } });
    const banned = await request(app).get("/api/app/me").set(auth());
    expect(banned.status).toBe(403);
    expect(banned.body.details.code).toBe("banned");
    await prisma.user.update({ where: { telegramId: 5001n }, data: { isBanned: false } });

    await setSetting("maintenance_mode", true);
    const m = await request(app).get("/api/app/me").set(auth());
    expect(m.status).toBe(503);
    expect(m.body.details.code).toBe("maintenance");
    const admin = (await request(app).post("/api/app/auth/telegram").send({ initData: initData(9001) })).body.token as string;
    expect((await request(app).get("/api/app/me").set({ Authorization: `Bearer ${admin}` })).status).toBe(200);
    await setSetting("maintenance_mode", false);
  });

  it("video chatga yuboriladi (file_id frontendga chiqmaydi)", async () => {
    const res = await request(app).post("/api/app/products/4b/video").set(auth());
    expect(res.body).toEqual({ sent: true });
    expect((await request(app).post("/api/app/products/qd/video").set(auth())).status).toBe(404);
  });

  it("profil rasmi Bot API orqali proksi qilinadi, rasm yo'q bo'lsa 404", async () => {
    expect((await request(app).get("/api/app/me/photo").set(auth())).status).toBe(404);
    expect((await request(app).get("/api/app/me/photo")).status).toBe(401);

    const login = await request(app).post("/api/app/auth/telegram").send({ initData: initData(777) });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([0xff, 0xd8, 0xff])));
    try {
      const res = await request(app).get("/api/app/me/photo").set({ Authorization: `Bearer ${login.body.token}` });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/jpeg");
      expect(String(fetchMock.mock.calls[0][0])).toContain("/photos/file_1.jpg");
    } finally {
      fetchMock.mockRestore();
    }
  });
});
