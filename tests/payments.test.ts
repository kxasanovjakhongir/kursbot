import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Api } from "grammy";
import type { Express } from "express";
import { config } from "../src/config";
import { checkPaymeAuth, paymeCheckoutUrl, PAYME_TX_TIMEOUT_MS } from "../src/services/payments/payme";
import { clickCheckoutUrl, clickSign } from "../src/services/payments/click";
import { parseOrderId } from "../src/services/payments/common";
import { parsePayRef, shortPayUrl } from "../src/services/payments/payLink";
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

  it("Payme: test rejimida PAYME_TEST_KEY, haqiqiy rejimda PAYME_KEY", () => {
    cfg.PAYME_TEST_KEY = "sandbox-key";
    try {
      expect(checkPaymeAuth(basic("sandbox-key"))).toBe(true);
      expect(checkPaymeAuth(basic(TEST_PAYMENTS.PAYME_KEY))).toBe(false);
      cfg.PAYME_TEST_MODE = false;
      expect(checkPaymeAuth(basic(TEST_PAYMENTS.PAYME_KEY))).toBe(true);
      expect(checkPaymeAuth(basic("sandbox-key"))).toBe(false);
    } finally {
      cfg.PAYME_TEST_KEY = undefined;
      cfg.PAYME_TEST_MODE = TEST_PAYMENTS.PAYME_TEST_MODE;
    }
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
    expect(url.origin + url.pathname).toBe("https://my.click.uz/services/pay/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      service_id: "12345",
      merchant_id: "6789",
      amount: "1000",
      transaction_param: "7",
      return_url: "https://t.me/test_bot",
    });
  });

  it("qisqa to'lov havolasi: o'z domenimiz, imzo buyurtma va tizimga bog'langan", () => {
    const url = shortPayUrl("click", 7n)!;
    expect(url).toMatch(/^https:\/\/app\.example\.uz\/pay\/click\/7-[\w-]{16}$/);
    const ref = url.split("/").pop()!;
    expect(parsePayRef("click", ref)).toBe(7n);
    // Boshqa buyurtma yoki boshqa tizim uchun o'sha imzo yaramaydi
    expect(parsePayRef("click", ref.replace(/^7-/, "8-"))).toBeNull();
    expect(parsePayRef("payme", ref)).toBeNull();
    for (const bad of ["7", "7-", "-abc", "abc", `${ref}x`]) expect(parsePayRef("click", bad)).toBeNull();
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
  const kicked: number[] = [];
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
    banChatMember: async (_chatId: number, userId: number) => {
      kicked.push(userId);
      return true;
    },
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

  it("Payme protokoli: text/json qabul qilinadi, buzuq JSON -32700, POST emas -32300 — hammasi HTTP 200", async () => {
    // Hujjatdagi so'rov namunasi: Content-Type: text/json; charset=UTF-8
    const asText = await request(app)
      .post("/api/payments/payme")
      .set("Authorization", basic(TEST_PAYMENTS.PAYME_KEY))
      .set("Content-Type", "text/json; charset=UTF-8")
      .send(JSON.stringify({ id: 7, method: "CheckTransaction", params: { id: "nope" } }));
    expect(asText.status).toBe(200);
    expect(asText.body).toMatchObject({ id: 7, error: { code: -31003 } });

    const broken = await request(app)
      .post("/api/payments/payme")
      .set("Authorization", basic(TEST_PAYMENTS.PAYME_KEY))
      .set("Content-Type", "application/json")
      .send("{ buzuq");
    expect(broken.status).toBe(200);
    expect(broken.body.error.code).toBe(-32700);

    const get = await request(app).get("/api/payments/payme");
    expect(get.status).toBe(200);
    expect(get.body.error.code).toBe(-32300);
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
    // Boshqa tranzaksiya shu buyurtmaga — Payme hujjati (sandbox «В ожидании оплаты»): -31008
    expect((await payme("CreateTransaction", { id: "pm-tx-2", time, amount, account })).body.error.code).toBe(-31008);
    // Tekshiruv ham band deydi (sandbox: «Обрабатывается»)
    expect((await payme("CheckPerformTransaction", { amount, account })).body.error.code).toBe(-31053);

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
    // Muddati o'tgan tranzaksiya hisobni band qilmaydi
    expect((await payme("CheckPerformTransaction", { amount: order.amount * 100, account })).body.result).toEqual({ allow: true });
  });

  it("Payme: to'lanmagan tranzaksiyani bekor qilish (-1), buyurtma ochiq qoladi", async () => {
    const order = await newOrder();
    const account = { order_id: order.id.toString() };
    await payme("CreateTransaction", { id: "pm-c", time: Date.now(), amount: order.amount * 100, account });
    expect((await payme("CancelTransaction", { id: "pm-c", reason: 3 })).body.result.state).toBe(-1);
    expect((await payme("PerformTransaction", { id: "pm-c" })).body.error.code).toBe(-31008);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("new");
    // Bekor qilingandan keyin hisob yana bo'sh — qayta to'lash mumkin
    expect((await payme("CheckPerformTransaction", { amount: order.amount * 100, account })).body.result).toEqual({ allow: true });
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

    it("Click to'langan to'lovni bekor qilsa — pul qaytarilgan: buyurtma refunded, kanaldan chiqariladi", async () => {
      await prisma.accessGrant.deleteMany({});
      const order = await newOrder();
      const prep = await request(app).post("/api/payments/click/prepare").type("form").send(signed({ ...base(order.id, "c5"), action: "0" }, 0));
      const complete = (error: string) =>
        request(app)
          .post("/api/payments/click/complete")
          .type("form")
          .send(signed({ ...base(order.id, "c5"), error, action: "1", merchant_prepare_id: String(prep.body.merchant_prepare_id) }, 1));
      expect((await complete("0")).body.error).toBe(0);
      await vi.waitFor(async () => expect(await prisma.accessGrant.count({ where: { orderId: order.id, revokedAt: null } })).toBe(1));

      kicked.length = 0;
      expect((await complete("-5017")).body.error).toBe(-9);
      await vi.waitFor(async () => expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("refunded"));
      expect(await prisma.accessGrant.count({ where: { orderId: order.id, revokedAt: null } })).toBe(0);
      expect(kicked).toEqual([7001]);
      expect((await prisma.paymentTransaction.findFirstOrThrow({ where: { externalId: "c5" } })).state).toBe(-2);

      // Takroriy bekor qilish so'rovi — qayta chiqarilmaydi
      kicked.length = 0;
      expect((await complete("-5017")).body.error).toBe(-9);
      expect(kicked).toEqual([]);
    });

    describe("chekka holatlar", () => {
      const post = (path: "prepare" | "complete", body: Record<string, string>) => request(app).post(`/api/payments/click/${path}`).type("form").send(body);
      const prepare = (orderId: bigint, id: string, amount?: string) => post("prepare", signed({ ...base(orderId, id, amount), action: "0" }, 0));
      const complete = (orderId: bigint, id: string, prepareId: unknown, extra: Record<string, string> = {}, amount?: string) =>
        post("complete", signed({ ...base(orderId, id, amount), action: "1", merchant_prepare_id: String(prepareId), ...extra }, 1));
      const freshOrder = async () => {
        await prisma.accessGrant.deleteMany({});
        return newOrder();
      };
      const orderOf = (id: bigint) => prisma.order.findUniqueOrThrow({ where: { id } });
      const txOf = (externalId: string) => prisma.paymentTransaction.findFirst({ where: { provider: "click", externalId } });

      it("noto'g'ri so'rovlar: maydon yetishmasa -8, begona servis -8, bosqich mos emas -3, buyurtma yo'q -5", async () => {
        const order = await freshOrder();
        const { sign_time: _omit, ...noTime } = { ...base(order.id, "e1"), action: "0" };
        expect((await post("prepare", { ...noTime, sign_string: "x" })).body.error).toBe(-8);
        expect((await post("prepare", {})).body).toMatchObject({ error: -8, click_trans_id: null, merchant_trans_id: null });

        // Imzo to'g'ri, lekin servis bizniki emas
        expect((await post("prepare", signed({ ...base(order.id, "e1"), service_id: "99999", action: "0" }, 0))).body.error).toBe(-8);
        // Prepare so'rovi (action=0) complete manziliga
        expect((await post("complete", signed({ ...base(order.id, "e1"), action: "0", merchant_prepare_id: "1" }, 1))).body.error).toBe(-3);
        // Complete, lekin merchant_prepare_id yo'q
        expect((await post("complete", signed({ ...base(order.id, "e1"), action: "1" }, 1))).body.error).toBe(-8);

        expect((await prepare(999_999n, "e1")).body.error).toBe(-5);
        expect((await post("prepare", signed({ ...base(order.id, "e1"), merchant_trans_id: "abc", action: "0" }, 0))).body.error).toBe(-5);
        expect((await post("prepare", signed({ ...base(order.id, "e1"), merchant_trans_id: "0", action: "0" }, 0))).body.error).toBe(-5);

        // Hech biri tranzaksiya yaratmagan, buyurtma o'zgarmagan
        expect(await txOf("e1")).toBeNull();
        expect((await orderOf(order.id)).status).toBe("new");
      });

      it("JSON ko'rinishidagi so'rov va katta harfli imzo ham qabul qilinadi", async () => {
        const order = await freshOrder();
        const body = signed({ ...base(order.id, "e2"), action: "0" }, 0);
        const res = await request(app).post("/api/payments/click/prepare").send({ ...body, sign_string: body.sign_string.toUpperCase() });
        expect(res.body.error).toBe(0);
      });

      it("to'lovga yaroqsiz buyurtma: chek tekshiruvda, muddati o'tgan, bekor qilingan — -5", async () => {
        const order = await freshOrder();
        for (const [n, data] of [
          [1, { status: "receipt_sent" as const }],
          [2, { status: "new" as const, expiresAt: new Date(Date.now() - 60_000) }],
          [3, { status: "cancelled" as const }],
          [4, { status: "expired" as const }],
        ] as const) {
          await prisma.order.update({ where: { id: order.id }, data });
          expect([n, (await prepare(order.id, `e3-${n}`)).body.error]).toEqual([n, -5]);
        }
        expect(await prisma.paymentTransaction.count({ where: { orderId: order.id } })).toBe(0);
      });

      it("rad etilgan buyurtmani (chek qaytarilgan) Click orqali to'lash mumkin", async () => {
        const order = await freshOrder();
        await prisma.order.update({ where: { id: order.id }, data: { status: "rejected", rejectReason: "Summa kam" } });
        const prep = await prepare(order.id, "e4");
        expect(prep.body.error).toBe(0);
        expect((await complete(order.id, "e4", prep.body.merchant_prepare_id)).body.error).toBe(0);
        expect(await orderOf(order.id)).toMatchObject({ status: "approved", paymentMethod: "click", rejectReason: null });
      });

      it("summa ko'rinishlari: 150000.00 qabul qilinadi; tiyinli yoki noto'g'ri summa -2", async () => {
        const order = await freshOrder();
        for (const bad of ["150000.5", "149999.99", "150000.001", "1e5", "-150000", "0"]) {
          expect([bad, (await prepare(order.id, "e5", bad)).body.error]).toEqual([bad, -2]);
        }
        const prep = await prepare(order.id, "e5", "150000.00");
        expect(prep.body.error).toBe(0);
        // Complete'da summa boshqa — rad, buyurtma ochiq
        expect((await complete(order.id, "e5", prep.body.merchant_prepare_id, {}, "1000")).body.error).toBe(-2);
        expect((await orderOf(order.id)).status).toBe("new");
        expect((await complete(order.id, "e5", prep.body.merchant_prepare_id, {}, "150000.0")).body.error).toBe(0);
        expect((await orderOf(order.id)).status).toBe("approved");
      });

      it("takroriy prepare — o'sha tranzaksiya; yangi urinish eskisini bekor qiladi", async () => {
        const order = await freshOrder();
        const first = await prepare(order.id, "e6a");
        const repeat = await prepare(order.id, "e6a");
        expect(repeat.body).toMatchObject({ error: 0, merchant_prepare_id: first.body.merchant_prepare_id });
        expect(await prisma.paymentTransaction.count({ where: { orderId: order.id } })).toBe(1);

        const second = await prepare(order.id, "e6b");
        expect(second.body.error).toBe(0);
        expect(second.body.merchant_prepare_id).not.toBe(first.body.merchant_prepare_id);
        expect((await txOf("e6a"))?.state).toBe(-1);
        // Bekor qilingan urinish endi to'lanmaydi va qayta prepare ham qilinmaydi
        expect((await complete(order.id, "e6a", first.body.merchant_prepare_id)).body.error).toBe(-9);
        expect((await prepare(order.id, "e6a")).body.error).toBe(-9);
        expect((await orderOf(order.id)).status).toBe("new");

        expect((await complete(order.id, "e6b", second.body.merchant_prepare_id)).body.error).toBe(0);
        expect((await orderOf(order.id)).status).toBe("approved");
      });

      it("complete begona ma'lumot bilan: boshqa tranzaksiya, boshqa buyurtma, buzilgan imzo", async () => {
        const order = await freshOrder();
        const prep = await prepare(order.id, "e7");
        const id = prep.body.merchant_prepare_id;
        // merchant_prepare_id to'g'ri, click_trans_id boshqa
        expect((await complete(order.id, "e7-other", id)).body.error).toBe(-6);
        // Tranzaksiya to'g'ri, buyurtma raqami boshqa
        expect((await complete(order.id + 1000n, "e7", id)).body.error).toBe(-6);
        expect((await complete(order.id, "e7", "abc")).body.error).toBe(-6);
        // Imzodan keyin summa almashtirilgan
        const tampered = { ...signed({ ...base(order.id, "e7"), action: "1", merchant_prepare_id: String(id) }, 1), amount: "1" };
        expect((await post("complete", tampered)).body.error).toBe(-1);
        expect((await orderOf(order.id)).status).toBe("new");
        expect((await txOf("e7"))?.state).toBe(1);
      });

      it("bir vaqtda kelgan 6 ta complete — bir marta to'lanadi, bitta kirish", async () => {
        const order = await freshOrder();
        const prep = await prepare(order.id, "e8");
        const results = await Promise.all(Array.from({ length: 6 }, () => complete(order.id, "e8", prep.body.merchant_prepare_id)));
        const codes = results.map((r) => r.body.error as number).sort((a, b) => b - a);
        expect(codes).toEqual([0, -4, -4, -4, -4, -4]);
        await vi.waitFor(async () => expect(await prisma.accessGrant.count({ where: { orderId: order.id } })).toBe(1));
        expect(await prisma.paymentTransaction.count({ where: { orderId: order.id, state: 2 } })).toBe(1);
      });

      it("prepare'dan keyin buyurtma muddati o'tsa yoki mijoz bekor qilsa ham — pul olingan, kirish beriladi", async () => {
        for (const [n, data] of [
          [1, { status: "expired" as const }],
          [2, { status: "cancelled" as const }],
        ] as const) {
          const order = await freshOrder();
          const prep = await prepare(order.id, `e9-${n}`);
          await prisma.order.update({ where: { id: order.id }, data });
          expect((await complete(order.id, `e9-${n}`, prep.body.merchant_prepare_id)).body.error).toBe(0);
          expect(await orderOf(order.id)).toMatchObject({ status: "approved", paymentMethod: "click" });
          await vi.waitFor(async () => expect(await prisma.accessGrant.count({ where: { orderId: order.id, revokedAt: null } })).toBe(1));
        }
      });

      it("ikki marta to'lov: karta cheki tasdiqlangan buyurtmaga Click puli tushsa — kirish o'zgarmaydi, qaytarilsa ham", async () => {
        const order = await freshOrder();
        const prep = await prepare(order.id, "e10");
        // Shu orada admin karta chekini tasdiqladi
        await prisma.order.update({ where: { id: order.id }, data: { status: "approved", paidAt: new Date(), paymentMethod: "card" } });
        const grant = await prisma.accessGrant.create({ data: { userId, productId, orderId: order.id } });

        expect((await complete(order.id, "e10", prep.body.merchant_prepare_id)).body.error).toBe(0);
        expect(await orderOf(order.id)).toMatchObject({ status: "approved", paymentMethod: "card" });
        expect((await txOf("e10"))?.state).toBe(2);

        // Ortiqcha to'lov qaytarildi — mijoz kanalda qoladi
        kicked.length = 0;
        expect((await complete(order.id, "e10", prep.body.merchant_prepare_id, { error: "-5017" })).body.error).toBe(-9);
        await vi.waitFor(async () => expect((await txOf("e10"))?.state).toBe(-2));
        await new Promise((r) => setTimeout(r, 200));
        expect((await orderOf(order.id)).status).toBe("approved");
        expect((await prisma.accessGrant.findUniqueOrThrow({ where: { id: grant.id } })).revokedAt).toBeNull();
        expect(kicked).toEqual([]);
      });
    });
  });

  it("qisqa havola /pay/...: to'lov sahifasiga yo'naltiradi; noto'g'ri imzo yoki buyurtma — 404", async () => {
    const order = await newOrder();
    const res = await request(app).get(new URL(shortPayUrl("click", order.id)!).pathname);
    expect(res.status).toBe(302);
    const to = new URL(res.headers.location);
    expect(to.origin + to.pathname).toBe("https://my.click.uz/services/pay/");
    expect(Object.fromEntries(to.searchParams)).toMatchObject({ amount: "150000", transaction_param: order.id.toString(), return_url: "https://t.me/test_bot" });

    const payme = await request(app).get(new URL(shortPayUrl("payme", order.id)!).pathname);
    expect(payme.headers.location.startsWith("https://checkout.test.paycom.uz/")).toBe(true);

    expect((await request(app).get(`/pay/click/${order.id}-aaaaaaaaaaaaaaaa`)).status).toBe(404);
    expect((await request(app).get(new URL(shortPayUrl("click", 999999n)!).pathname)).status).toBe(404);
    expect((await request(app).get(`/pay/other/${order.id}-x`)).status).toBe(404);
  });

  it("sozlanmagan tizim endpointi 404", async () => {
    cfg.CLICK_SECRET_KEY = undefined;
    expect((await request(app).post("/api/payments/click/prepare").type("form").send({})).status).toBe(404);
    cfg.CLICK_SECRET_KEY = TEST_PAYMENTS.CLICK_SECRET_KEY;
  });
});
