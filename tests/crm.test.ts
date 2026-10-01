import { describe, expect, it, vi } from "vitest";
import { buildLeadPayload, sendLeadToCrm } from "../src/services/crm";

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
