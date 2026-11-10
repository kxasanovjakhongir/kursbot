import { describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db";
import { buildLeadPayload, postToCrm, sendLeadToCrm } from "../src/services/crm";
import { buildPaymentPayload, buildRefundPayload, crmTransactionId, sendPaymentToCrm, sendRefundToCrm } from "../src/services/crmPayments";

const user = {
  id: 1n,
  telegramId: 123456789n,
  firstName: "Ali",
  lastName: "Valiyev",
  username: "ali_v",
  phone: "+998901234567",
};
const URL = "https://crm.example.uz/api/webhook/bot/secret";

function res(status: number, body = ""): Response {
  return new Response(body, { status });
}

describe("CRM lid payload", () => {
  it("CRM kutgan formatda", () => {
    expect(buildLeadPayload(user)).toEqual({
      first_name: "Ali",
      last_name: "Valiyev",
      phone: "+998901234567",
      telegram_id: "123456789",
      telegram_username: "ali_v",
    });
  });
  it("bo'sh maydonlar — bo'sh satr, telefon + bilan", () => {
    expect(buildLeadPayload({ ...user, lastName: null, username: null, phone: "998901234567" })).toMatchObject({
      last_name: "",
      telegram_username: "",
      phone: "+998901234567",
    });
  });
  it("telefonsiz — yuborilmaydi", () => {
    expect(buildLeadPayload({ ...user, phone: null })).toBeNull();
  });
});

describe("sendLeadToCrm", () => {
  it("URL sozlanmagan bo'lsa so'rov yuborilmaydi", async () => {
    const fetchImpl = vi.fn();
    expect(await sendLeadToCrm(user, { url: "", fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POST JSON yuboradi", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200));
    expect(await sendLeadToCrm(user, { url: URL, fetchImpl })).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body).telegram_id).toBe("123456789");
  });

  it("5xx va tarmoq xatosida qayta urinadi", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(res(502)).mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(res(201));
    expect(await sendLeadToCrm(user, { url: URL, fetchImpl, retryDelayMs: 0 })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("4xx da qayta urinmaydi", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(400, "bad"));
    expect(await sendLeadToCrm(user, { url: URL, fetchImpl, retryDelayMs: 0 })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("3 urinishdan keyin to'xtaydi va xato tashlamaydi", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("timeout"));
    expect(await sendLeadToCrm(user, { url: URL, fetchImpl, retryDelayMs: 0 })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("CRM to'lov payload", () => {
  const facts = {
    transactionId: "payme-6512ab34",
    orderId: 75n,
    amount: 1_500_000,
    method: "payme" as const,
    telegramId: 123456789n,
    phone: "+998901234567",
    courseTitle: "Python",
  };

  it("CRM kutgan formatda", () => {
    expect(buildPaymentPayload(facts)).toEqual({
      transaction_id: "payme-6512ab34",
      order_id: "75",
      amount: 1500000,
      currency: "UZS",
      method: "payme",
      telegram_id: "123456789",
      phone: "+998901234567",
      kurs: "Python",
    });
  });
  it("telefon + bilan, yo'q bo'lsa bo'sh satr", () => {
    expect(buildPaymentPayload({ ...facts, phone: "998901234567" }).phone).toBe("+998901234567");
    expect(buildPaymentPayload({ ...facts, phone: null }).phone).toBe("");
  });
  it("tranzaksiya raqami: to'lov tizimi raqami bo'lsa shu, bo'lmasa buyurtma raqami", () => {
    expect(crmTransactionId("click", "987", 5n)).toBe("click-987");
    expect(crmTransactionId("card", null, 5n)).toBe("card-order-5");
  });
  it("faqat payme va click CRM'ga yuboriladi", async () => {
    const spy = vi.spyOn(prisma.order, "findUnique").mockResolvedValue({ id: 7n, paymentMethod: "card" } as never);
    const fetchImpl = vi.fn();
    expect(await sendPaymentToCrm(7n, { url: URL, fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("CRM 404 (lid yo'q) desa: avval lid yuboriladi, keyin to'lov qayta yuboriladi", async () => {
    const order = {
      id: 9n,
      amount: 1000,
      paymentMethod: "payme",
      user: { id: 1n, telegramId: 123456789n, firstName: "Ali", lastName: null, username: null, phone: "+998901234567" },
      product: { title: "Python" },
      transactions: [{ externalId: "abc" }],
    };
    const spy = vi.spyOn(prisma.order, "findUnique").mockResolvedValue(order as never);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res(404, '{"success":false}'))
      .mockResolvedValueOnce(res(200))
      .mockResolvedValueOnce(res(200, '{"movedToWon":true}'));
    expect(await sendPaymentToCrm(9n, { url: URL + "/payment", leadUrl: URL, fetchImpl, retryDelayMs: 0 })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][0]).toBe(URL + "/payment");
    expect(fetchImpl.mock.calls[1][0]).toBe(URL);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).phone).toBe("+998901234567");
    expect(fetchImpl.mock.calls[2][0]).toBe(URL + "/payment");
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body).transaction_id).toBe("payme-abc");
    spy.mockRestore();
  });
  it("lid ham qabul qilinmasa to'lov qayta yuborilmaydi", async () => {
    const order = {
      id: 9n,
      amount: 1000,
      paymentMethod: "click",
      user: { id: 1n, telegramId: 1n, firstName: "A", lastName: null, username: null, phone: "+998901234567" },
      product: { title: "Python" },
      transactions: [],
    };
    const spy = vi.spyOn(prisma.order, "findUnique").mockResolvedValue(order as never);
    const fetchImpl = vi.fn().mockResolvedValue(res(404));
    expect(await sendPaymentToCrm(9n, { url: URL + "/payment", leadUrl: URL, fetchImpl, retryDelayMs: 0 })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
  it("URL sozlanmagan bo'lsa to'lov so'rovi yuborilmaydi", async () => {
    const fetchImpl = vi.fn();
    expect(await sendPaymentToCrm(1n, { url: "", fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("postToCrm POST JSON yuboradi va 4xx da qayta urinmaydi", async () => {
    const ok = vi.fn().mockResolvedValue(res(200));
    expect(await postToCrm(URL, buildPaymentPayload(facts), "to'lov", {}, { fetchImpl: ok })).toBe(true);
    expect(JSON.parse(ok.mock.calls[0][1].body).transaction_id).toBe("payme-6512ab34");
    const bad = vi.fn().mockResolvedValue(res(400, "xato"));
    expect(await postToCrm(URL, {}, "to'lov", {}, { fetchImpl: bad, retryDelayMs: 0 })).toBe(false);
    expect(bad).toHaveBeenCalledTimes(1);
  });
});

describe("CRM qaytarish (refund)", () => {
  it("CRM kutgan formatda", () => {
    expect(buildRefundPayload({ transactionId: "payme-abc", orderId: 75n, amount: 1000, telegramId: 123456789n })).toEqual({
      transaction_id: "payme-abc",
      order_id: "75",
      amount: 1000,
      telegram_id: "123456789",
      status: "refunded",
    });
  });
  it("URL sozlanmagan bo'lsa yuborilmaydi", async () => {
    const fetchImpl = vi.fn();
    expect(await sendRefundToCrm(1n, { url: "", fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("to'lov bilan bir xil transaction_id bilan yuboradi", async () => {
    const order = {
      id: 9n,
      amount: 1000,
      paymentMethod: "payme",
      user: { telegramId: 123456789n },
      transactions: [{ externalId: "abc" }],
    };
    const spy = vi.spyOn(prisma.order, "findUnique").mockResolvedValue(order as never);
    const fetchImpl = vi.fn().mockResolvedValue(res(200));
    expect(await sendRefundToCrm(9n, { url: URL + "/refund", fetchImpl })).toBe(true);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(fetchImpl.mock.calls[0][0]).toBe(URL + "/refund");
    expect(body).toMatchObject({ transaction_id: "payme-abc", order_id: "9", amount: 1000, status: "refunded" });
    spy.mockRestore();
  });
  it("karta buyurtmasi CRM'ga yuborilmagan — qaytarish ham yuborilmaydi", async () => {
    const spy = vi.spyOn(prisma.order, "findUnique").mockResolvedValue({ id: 9n, paymentMethod: "card", user: {}, transactions: [] } as never);
    const fetchImpl = vi.fn();
    expect(await sendRefundToCrm(9n, { url: URL + "/refund", fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
