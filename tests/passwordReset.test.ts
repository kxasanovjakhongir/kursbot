import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Api } from "grammy";
import type { Express } from "express";
import { prisma } from "../src/db";
import { createApp } from "../src/api/app";
import { createPanelUser } from "../src/services/panelUsers";
import { setMailSender, type MailMessage } from "../src/services/mail";
import { generateOtp, OTP_MAX_ATTEMPTS, requestPasswordReset } from "../src/services/adminOtp";

const enabled = !!process.env.TEST_DATABASE_URL;

const fakeApi = { getMe: async () => ({ id: 1, is_bot: true, first_name: "T", username: "t_bot" }) } as unknown as Api;
const mails: MailMessage[] = [];
const FORGOT_MESSAGE = "Agar email ro'yxatdan o'tgan bo'lsa, kod yuborildi";

/** Xatdagi kod (kod bazada faqat xesh sifatida saqlanadi — uni faqat xatdan olish mumkin) */
async function mailedCode(to: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const m = mails.filter((x) => x.to === to).at(-1);
    if (m) return /\b(\d{6})\b/.exec(m.text)![1];
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`xat kelmadi: ${to}`);
}

describe("generateOtp", () => {
  it("har doim 6 ta raqam (boshidagi nollar bilan)", () => {
    for (let i = 0; i < 500; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });
});

describe.skipIf(!enabled)("Parolni unutdim: OTP orqali kirish va majburiy parol almashtirish", () => {
  let app: Express;
  let n = 0;
  /** Har bir test o'z adminiga ega (email bo'yicha rate limit testlar orasida ulashilmasin) */
  const newAdmin = async () => {
    const email = `otp${++n}-${Date.now()}@test.uz`;
    await createPanelUser({ email, name: `Admin ${n}`, password: "eskiparol1", role: "superadmin" });
    return email;
  };
  const verify = (email: string, code: string) => request(app).post("/api/auth/verify-otp").send({ email, code });

  beforeAll(async () => {
    setMailSender(async (m) => void mails.push(m));
    await prisma.panelUser.deleteMany({ where: { email: { startsWith: "otp" } } });
    app = createApp({ runtime: { api: fakeApi, mode: "polling", tokenSource: "env", isRunning: () => true } });
  });
  beforeEach(() => void (mails.length = 0));
  afterAll(async () => {
    setMailSender(null);
    await prisma.panelUser.deleteMany({ where: { email: { startsWith: "otp" } } });
    await prisma.$disconnect();
  });

  it("mavjud va mavjud bo'lmagan email — javob bir xil; xat faqat ro'yxatdagiga, kod bazada ochiq saqlanmaydi", async () => {
    const email = await newAdmin();
    const known = await request(app).post("/api/auth/forgot-password").send({ email: email.toUpperCase() });
    const unknown = await request(app).post("/api/auth/forgot-password").send({ email: "yoq-bunday@test.uz" });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(known.body.message).toBe(FORGOT_MESSAGE);

    const code = await mailedCode(email);
    expect(mails.map((m) => m.to)).toEqual([email]);
    expect(mails[0].subject).not.toContain(code);
    expect(mails[0].html).toContain("10 daqiqa");
    expect(mails[0].html).toContain("Agar siz so'ramagan bo'lsangiz, bu xatni e'tiborsiz qoldiring");

    const otp = await prisma.adminOtp.findFirstOrThrow({ where: { admin: { email } } });
    expect(otp.codeHash).not.toContain(code);
    expect(otp.codeHash).toMatch(/^\$2[aby]\$/);
    expect(otp.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(otp.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);

    // Loglarda kod yo'q, hodisa bor
    const logs = await prisma.activityLog.findMany({ where: { action: { in: ["OTP_REQUESTED", "OTP_FAILED", "OTP_LOGIN"] } } });
    expect(logs.some((l) => l.action === "OTP_REQUESTED")).toBe(true);
    expect(logs.map((l) => l.description).join("\n")).not.toContain(code);
  });

  it("bitta email uchun 60 soniyada faqat 1 ta so'rov", async () => {
    const email = await newAdmin();
    expect((await request(app).post("/api/auth/forgot-password").send({ email })).status).toBe(200);
    const again = await request(app).post("/api/auth/forgot-password").send({ email });
    expect(again.status).toBe(429);
    expect(again.body.code).toBe("rate_limited");
  });

  it("to'g'ri kod: kirish, faqat parol sahifasi ochiq, joriy parolsiz yangi parol, eski sessiyalar bekor", async () => {
    const email = await newAdmin();
    const oldSession = (await request(app).post("/api/auth/login").send({ email, password: "eskiparol1" })).body.token as string;
    await requestPasswordReset(email, "127.0.0.1");
    const ok = await verify(email, await mailedCode(email));
    expect(ok.status).toBe(200);
    expect(ok.body.mustChangePassword).toBe(true);
    expect(ok.body.user.mustChangePassword).toBe(true);
    expect(JSON.stringify(ok.body)).not.toContain("passwordHash");
    const auth = { Authorization: `Bearer ${ok.body.token}` };

    // must_change_password: boshqa hamma narsa 403 PASSWORD_CHANGE_REQUIRED
    for (const [method, url] of [
      ["get", "/api/dashboard/stats"],
      ["get", "/api/bot/settings"],
      ["put", "/api/auth/profile"],
      ["get", "/api/admins"],
    ] as const) {
      const res = await request(app)[method](url).set(auth).send({ name: "Yangi ism" });
      expect([url, res.status, res.body.code]).toEqual([url, 403, "PASSWORD_CHANGE_REQUIRED"]);
    }
    expect((await request(app).get("/api/auth/me").set(auth)).status).toBe(200);
    // Eski (parol bilan olingan) sessiya ham cheklangan — bayroq bazada, tokenda emas
    expect((await request(app).get("/api/dashboard/stats").set("Authorization", `Bearer ${oldSession}`)).status).toBe(403);

    // Parol talabi: harf va raqam
    expect((await request(app).put("/api/auth/password").set(auth).send({ newPassword: "faqatharflar" })).status).toBe(400);
    expect((await request(app).put("/api/auth/password").set(auth).send({ newPassword: "12345678" })).status).toBe(400);
    expect((await request(app).put("/api/auth/password").set(auth).send({ newPassword: "qisqa1" })).status).toBe(400);

    const changed = await request(app).patch("/api/auth/password").set(auth).send({ newPassword: "yangiParol7" });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
    expect((await prisma.panelUser.findUniqueOrThrow({ where: { email } })).mustChangePassword).toBe(false);

    // Boshqa barcha sessiyalar bekor, yangi token ishlaydi
    expect((await request(app).get("/api/auth/me").set(auth)).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${oldSession}`)).status).toBe(401);
    expect((await request(app).get("/api/dashboard/stats").set("Authorization", `Bearer ${changed.body.token}`)).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ email, password: "yangiParol7" })).status).toBe(200);

    const log = await prisma.activityLog.findMany({ where: { panelUser: { email } }, orderBy: { id: "asc" } });
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["OTP_REQUESTED", "OTP_LOGIN", "CHANGE_PASSWORD"]));
    expect(log.every((l) => l.ipAddress)).toBe(true);
  });

  it("kod qayta ishlatilmaydi", async () => {
    const email = await newAdmin();
    await requestPasswordReset(email, null);
    const code = await mailedCode(email);
    expect((await verify(email, code)).status).toBe(200);
    const again = await verify(email, code);
    expect(again.status).toBe(400);
    expect(again.body.details).toMatchObject({ code: "OTP_INVALID", remainingAttempts: 0 });
  });

  it("noto'g'ri kod: urinishlar kamayadi, 5 ta xatodan keyin to'g'ri kod ham ishlamaydi", async () => {
    const email = await newAdmin();
    await requestPasswordReset(email, null);
    const code = await mailedCode(email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 1; i <= OTP_MAX_ATTEMPTS; i++) {
      const res = await verify(email, wrong);
      expect(res.status).toBe(400);
      expect(res.body.details.remainingAttempts).toBe(OTP_MAX_ATTEMPTS - i);
    }
    const blocked = await verify(email, code);
    expect(blocked.status).toBe(400);
    expect(blocked.body.details.remainingAttempts).toBe(0);
    expect((await prisma.panelUser.findUniqueOrThrow({ where: { email } })).mustChangePassword).toBe(false);
    const failed = await prisma.activityLog.count({ where: { action: "OTP_FAILED", panelUser: { email } } });
    expect(failed).toBe(OTP_MAX_ATTEMPTS + 1);
  });

  it("muddati o'tgan kod rad etiladi", async () => {
    const email = await newAdmin();
    await requestPasswordReset(email, null);
    const code = await mailedCode(email);
    await prisma.adminOtp.updateMany({ where: { admin: { email } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await verify(email, code);
    expect(res.status).toBe(400);
    expect(res.body.details.remainingAttempts).toBe(0);
  });

  it("yangi kod so'ralsa eskisi bekor bo'ladi", async () => {
    const email = await newAdmin();
    await requestPasswordReset(email, null);
    const first = await mailedCode(email);
    mails.length = 0;
    await requestPasswordReset(email, null);
    const second = await mailedCode(email);
    if (first !== second) expect((await verify(email, first)).status).toBe(400);
    expect((await verify(email, second)).status).toBe(200);
  });

  it("mavjud bo'lmagan email bilan kod tekshirish — bir xil xato", async () => {
    const res = await verify("yoq-bunday@test.uz", "123456");
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual({ code: "OTP_INVALID", remainingAttempts: 0 });
    expect((await verify("yoq-bunday@test.uz", "12ab56")).status).toBe(400);
  });

  it("o'chirilgan (nofaol) admin kod ololmaydi", async () => {
    const email = await newAdmin();
    await prisma.panelUser.update({ where: { email }, data: { isActive: false } });
    await requestPasswordReset(email, null);
    await new Promise((r) => setTimeout(r, 50));
    expect(mails).toHaveLength(0);
    expect(await prisma.adminOtp.count({ where: { admin: { email } } })).toBe(0);
  });

  it("oddiy holatda joriy parol talab qilinadi", async () => {
    const email = await newAdmin();
    const token = (await request(app).post("/api/auth/login").send({ email, password: "eskiparol1" })).body.token as string;
    const auth = { Authorization: `Bearer ${token}` };
    expect((await request(app).put("/api/auth/password").set(auth).send({ newPassword: "yangiParol7" })).status).toBe(400);
    expect((await request(app).put("/api/auth/password").set(auth).send({ currentPassword: "xato1234", newPassword: "yangiParol7" })).status).toBe(400);
    expect((await request(app).put("/api/auth/password").set(auth).send({ currentPassword: "eskiparol1", newPassword: "yangiParol7" })).status).toBe(200);
  });
});
