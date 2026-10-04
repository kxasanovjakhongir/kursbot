import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Api } from "grammy";
import type { Express } from "express";
import { config } from "../src/config";
import { checkPaymeAuth, paymeCheckoutUrl, PAYME_TX_TIMEOUT_MS } from "../src/services/payments/payme";
import { clickCheckoutUrl, clickSign } from "../src/services/payments/click";
import { parseOrderId } from "../src/services/payments/common";
import { prisma } from "../src/db";
import { createApp } from "../src/api/app";
import { createOrder } from "../src/services/orders";

const enabled = !!process.env.TEST_DATABASE_URL;

// Testlar uchun to'lov sozlamalari (config — oddiy obyekt; tugagach asl holiga qaytariladi)
const TEST_PAYMENTS = {
  PAYME_MERCHANT_ID: "5e730e8e0b852a417aa49ceb",
  PAYME_KEY: "test-payme-key-&abc",
  PAYME_ACCOUNT_FIELD: "order_id",
  PAYME_TEST_MODE: true,
  CLICK_SERVICE_ID: "12345",
  CLICK_MERCHANT_ID: "6789",
  CLICK_SECRET_KEY: "click-secret",
};
const saved: Record<string, unknown> = {};
const cfg = config as unknown as Record<string, unknown>;
function applyTestConfig() {
  for (const [k, v] of Object.entries(TEST_PAYMENTS)) {
    if (!(k in saved)) saved[k] = cfg[k];
    cfg[k] = v;
  }
}
function restoreConfig() {
  for (const [k, v] of Object.entries(saved)) cfg[k] = v;
}

const basic = (key: string) => `Basic ${Buffer.from(`Paycom:${key}`).toString("base64")}`;

describe("onlayn to'lov: yordamchi funksiyalar", () => {
  beforeAll(applyTestConfig);
  afterAll(restoreConfig);

  it("Payme Basic auth faqat to'g'ri kalit bilan o'tadi", () => {
    expect(checkPaymeAuth(basic(TEST_PAYMENTS.PAYME_KEY))).toBe(true);
    expect(checkPaymeAuth(basic("wrong"))).toBe(false);
    expect(checkPaymeAuth(undefined)).toBe(false);
    expect(checkPaymeAuth("Bearer x")).toBe(false);
  });

  it("Payme checkout havolasi: kassa, buyurtma va summa tiyinda", () => {
    const url = paymeCheckoutUrl(15n, 120000, { returnUrl: "https://t.me/test_bot", lang: "uz" });
    expect(url.startsWith("https://checkout.test.paycom.uz/")).toBe(true);
    const decoded = Buffer.from(url.split("/").pop()!, "base64").toString();
    expect(decoded).toBe("m=5e730e8e0b852a417aa49ceb;ac.order_id=15;a=12000000;l=uz;c=https://t.me/test_bot");
  });

  it("Click imzosi va to'lov havolasi", () => {
    const p = { click_trans_id: "1", service_id: "12345", merchant_trans_id: "7", amount: "1000", action: "0", sign_time: "2026-10-04 12:00:00" };
    const expected = createHash("md5").update(`112345click-secret710000${p.sign_time}`).digest("hex");
    expect(clickSign(p, 0)).toBe(expected);
    const url = new URL(clickCheckoutUrl(7n, 1000, { returnUrl: "https://t.me/test_bot" }));
    expect(url.origin + url.pathname).toBe("https://my.click.uz/services/pay");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      service_id: "12345",
      merchant_id: "6789",
      amount: "1000",
      transaction_param: "7",
      return_url: "https://t.me/test_bot",
    });
  });

  it("buyurtma raqami faqat musbat butun son", () => {
    expect(parseOrderId("12")).toBe(12n);
    expect(parseOrderId(12)).toBe(12n);
    expect(parseOrderId("0")).toBeNull();
    expect(parseOrderId("1e3")).toBeNull();
    expect(parseOrderId("-1")).toBeNull();
    expect(parseOrderId({})).toBeNull();
  });
});

describe.skipIf(!enabled)("onlayn to'lov: Payme va Click endpointlari", () => {
  const sent: { chatId: number; text: string }[] = [];
  const fakeApi = {
    token: "test",
    getMe: async () => ({ id: 42, is_bot: true, first_name: "Test bot", username: "test_bot" }),
    sendMessage: async (chatId: number, text: string) => {
      sent.push({ chatId, text });
      return { message_id: sent.length, chat: { id: chatId } };
    },
    createChatInviteLink: async () => ({ invite_link: `https://t.me/+pay${sent.length}` }),
    editMessageCaption: async () => true,
    editMessageText: async () => true,
    banChatMember: async () => true,
    unbanChatMember: async () => true,
    revokeChatInviteLink: async () => true,
    getChatMember: async () => ({ status: "administrator", can_invite_users: true, can_restrict_members: true }),
  } as unknown as Api;

  let app: Express;
  let userId: bigint;
  let productId: number;

  const payme = (method: string, params: Record<string, unknown>, key = TEST_PAYMENTS.PAYME_KEY) =>
    request(app).post("/api/payments/payme").set("Authorization", basic(key)).send({ jsonrpc: "2.0", id: 1, method, params });

  async function newOrder() {
    await prisma.order.updateMany({ where: { userId, status: { in: ["new", "rejected"] } }, data: { status: "cancelled" } });
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    const res = await createOrder(userId, product, null);
    if (res.kind !== "created") throw new Error(`buyurtma yaratilmadi: ${res.kind}`);
    return res.order;
  }

  beforeAll(async () => {
    applyTestConfig();
    await prisma.$executeRawUnsafe(
      `TRUNCATE payment_transactions, access_grants, receipts, orders, cards, products, users RESTART IDENTITY CASCADE`,
    );
    const user = await prisma.user.create({ data: { telegramId: 7001n, firstName: "Xaridor", phone: "998901234567" } });
    userId = user.id;
    const product = await prisma.product.create({ data: { code: "pay", title: "To'lov kursi", price: 150000, channelId: -1007777777n } });
    productId = product.id;
    app = createApp({ runtime: { api: fakeApi, mode: "polling", tokenSource: "env", isRunning: () => true } });
  });

  afterAll(restoreConfig);

  it("faol karta yo'q, lekin onlayn to'lov yoqilgan — buyurtma kartasiz yaratiladi", async () => {
    const order = await newOrder();
    expect(order.cardId).toBeNull();
    expect(order.amount).toBe(150000);
  });

  it("Payme: noto'g'ri kalit -32504", async () => {
    const res = await payme("CheckPerformTransaction", { amount: 1, account: { order_id: "1" } }, "bad");
    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe(-32504);
  });

  it("Payme: to'liq oqim — tekshirish, yaratish, to'lash, holat, hisobot, qaytarish", async () => {
    const order = await newOrder();
    const account = { order_id: order.id.toString() };
    const amount = order.amount * 100;

    expect((await payme("CheckPerformTransaction", { amount: amount - 100, account })).body.error.code).toBe(-31001);
    expect((await payme("CheckPerformTransaction", { amount, account: { order_id: "999999" } })).body.error.code).toBe(-31050);
    expect((await payme("CheckPerformTransaction", { amount, account })).body.result).toEqual({ allow: true });

    const time = Date.now();
    const created = await payme("CreateTransaction", { id: "pm-tx-1", time, amount, account });
    expect(created.body.result.state).toBe(1);
    const txId = created.body.result.transaction;
    // Takroriy so'rov — o'sha tranzaksiya
    expect((await payme("CreateTransaction", { id: "pm-tx-1", time, amount, account })).body.result.transaction).toBe(txId);
    // Boshqa tranzaksiya shu buyurtmaga — band
    expect((await payme("CreateTransaction", { id: "pm-tx-2", time, amount, account })).body.error.code).toBe(-31053);

    const performed = await payme("PerformTransaction", { id: "pm-tx-1" });
    expect(performed.body.result).toMatchObject({ transaction: txId, state: 2 });
    expect(performed.body.result.perform_time).toBeGreaterThan(0);
    // Takroriy Perform — o'sha natija
    expect((await payme("PerformTransaction", { id: "pm-tx-1" })).body.result.perform_time).toBe(performed.body.result.perform_time);

    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.status).toBe("approved");
    expect(paid.paymentMethod).toBe("payme");
    expect(paid.paidAt).not.toBeNull();
    // Fon rejimida: kanalga kirish va mijozga xabar
    await vi.waitFor(async () => {
      expect(await prisma.accessGrant.count({ where: { orderId: order.id, revokedAt: null } })).toBe(1);
      expect(sent.some((m) => m.chatId === 7001)).toBe(true);
    });

    // To'langan buyurtma qayta to'lanmaydi
    expect((await payme("CheckPerformTransaction", { amount, account })).body.error.code).toBe(-31051);

    const check = await payme("CheckTransaction", { id: "pm-tx-1" });
    expect(check.body.result).toMatchObject({ transaction: txId, state: 2, cancel_time: 0, reason: null });

    const statement = await payme("GetStatement", { from: time - 1000, to: time + 1000 });
    expect(statement.body.result.transactions).toHaveLength(1);
    expect(statement.body.result.transactions[0]).toMatchObject({ id: "pm-tx-1", amount, account, state: 2 });

    const cancelled = await payme("CancelTransaction", { id: "pm-tx-1", reason: 5 });
    expect(cancelled.body.result).toMatchObject({ transaction: txId, state: -2 });
    await vi.waitFor(async () => {
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("refunded");
      expect(await prisma.accessGrant.count({ where: { orderId: order.id, revokedAt: null } })).toBe(0);
    });
    // Takroriy bekor qilish — o'sha holat
    expect((await payme("CancelTransaction", { id: "pm-tx-1", reason: 5 })).body.result.state).toBe(-2);
    expect((await payme("CheckTransaction", { id: "nope" })).body.error.code).toBe(-31003);
    expect((await payme("ChangePassword", { password: "x" })).body.error.code).toBe(-32601);
  });

  it("Payme: 12 soatdan eski tranzaksiya to'lanmaydi va vaqt tugashi sababi bilan bekor qilinadi", async () => {
    const order = await newOrder();
    const account = { order_id: order.id.toString() };
    await payme("CreateTransaction", { id: "pm-old", time: Date.now(), amount: order.amount * 100, account });
    await prisma.paymentTransaction.updateMany({
      where: { externalId: "pm-old" },
      data: { createdAt: new Date(Date.now() - PAYME_TX_TIMEOUT_MS - 60_000) },
    });
    expect((await payme("PerformTransaction", { id: "pm-old" })).body.error.code).toBe(-31008);
    const tx = await prisma.paymentTransaction.findFirstOrThrow({ where: { externalId: "pm-old" } });
    expect(tx).toMatchObject({ state: -1, reason: 4 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("new");
  });

  it("Payme: to'lanmagan tranzaksiyani bekor qilish (-1), buyurtma ochiq qoladi", async () => {
    const order = await newOrder();
    const account = { order_id: order.id.toString() };
    await payme("CreateTransaction", { id: "pm-c", time: Date.now(), amount: order.amount * 100, account });
    expect((await payme("CancelTransaction", { id: "pm-c", reason: 3 })).body.result.state).toBe(-1);
    expect((await payme("PerformTransaction", { id: "pm-c" })).body.error.code).toBe(-31008);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("new");
  });

  describe("Click", () => {
    const signed = (p: Record<string, string>, action: 0 | 1) => ({ ...p, sign_string: clickSign(p, action) });
    const base = (orderId: bigint, clickTransId: string, amount = "150000") => ({
      click_trans_id: clickTransId,
      service_id: TEST_PAYMENTS.CLICK_SERVICE_ID,
      click_paydoc_id: `doc-${clickTransId}`,
      merchant_trans_id: orderId.toString(),
      amount,
      error: "0",
      error_note: "Success",
      sign_time: "2026-10-04 12:00:00",
    });

    it("prepare + complete — buyurtma tasdiqlanadi", async () => {
      const order = await newOrder();
      const bad = await request(app).post("/api/payments/click/prepare").type("form").send({ ...base(order.id, "c1"), action: "0", sign_string: "x" });
      expect(bad.body.error).toBe(-1);

      const wrongAmount = await request(app).post("/api/payments/click/prepare").type("form").send(signed({ ...base(order.id, "c1", "1000"), action: "0" }, 0));
      expect(wrongAmount.body.error).toBe(-2);

      const prep = await request(app).post("/api/payments/click/prepare").type("form").send(signed({ ...base(order.id, "c1"), action: "0" }, 0));
      expect(prep.body).toMatchObject({ error: 0, click_trans_id: "c1", merchant_trans_id: order.id.toString() });
      const prepareId = String(prep.body.merchant_prepare_id);

      const done = await request(app)
        .post("/api/payments/click/complete")
        .type("form")
        .send(signed({ ...base(order.id, "c1"), action: "1", merchant_prepare_id: prepareId }, 1));
      expect(done.body).toMatchObject({ error: 0, merchant_confirm_id: Number(prepareId) });

      const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(paid).toMatchObject({ status: "approved", paymentMethod: "click" });
      await vi.waitFor(async () => expect(await prisma.accessGrant.count({ where: { orderId: order.id } })).toBe(1));

      // Takroriy complete va to'langan buyurtmaga prepare — "Already paid"
      const again = await request(app)
        .post("/api/payments/click/complete")
        .type("form")
        .send(signed({ ...base(order.id, "c1"), action: "1", merchant_prepare_id: prepareId }, 1));
      expect(again.body.error).toBe(-4);
      const prep2 = await request(app).post("/api/payments/click/prepare").type("form").send(signed({ ...base(order.id, "c2"), action: "0" }, 0));
      expect(prep2.body.error).toBe(-4);
    });

    it("Click to'lov o'tmaganini bildirsa (error < 0) — tranzaksiya bekor, buyurtma ochiq", async () => {
      // Oldingi testda kirish berilgan — yangi xarid uchun o'chiramiz
      await prisma.accessGrant.deleteMany({});
      const order = await newOrder();
      const prep = await request(app).post("/api/payments/click/prepare").type("form").send(signed({ ...base(order.id, "c3"), action: "0" }, 0));
      expect(prep.body.error).toBe(0);
      const failed = await request(app)
        .post("/api/payments/click/complete")
        .type("form")
        .send(signed({ ...base(order.id, "c3"), error: "-5017", action: "1", merchant_prepare_id: String(prep.body.merchant_prepare_id) }, 1));
      expect(failed.body.error).toBe(-9);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("new");
      const unknown = await request(app)
        .post("/api/payments/click/complete")
        .type("form")
        .send(signed({ ...base(order.id, "c4"), action: "1", merchant_prepare_id: "99999" }, 1));
      expect(unknown.body.error).toBe(-6);
    });
  });

  it("sozlanmagan tizim endpointi 404", async () => {
    cfg.CLICK_SECRET_KEY = undefined;
    expect((await request(app).post("/api/payments/click/prepare").type("form").send({})).status).toBe(404);
    cfg.CLICK_SECRET_KEY = TEST_PAYMENTS.CLICK_SECRET_KEY;
  });
});
