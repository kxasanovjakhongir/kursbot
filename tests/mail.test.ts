import { afterEach, describe, expect, it, vi } from "vitest";
import { testMailbox } from "./setup";

const sentMails = testMailbox();

// Konfiguratsiyani test ichida o'zgartirish uchun (qolgan qiymatlar — haqiqiy config)
const smtp = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("../src/config", async (importOriginal) => {
  const real = await importOriginal<{ config: Record<string, unknown> }>();
  return { ...real, config: new Proxy(real.config, { get: (target, key: string) => (key in smtp ? smtp[key] : target[key]) }) };
});

import { passwordResetEmail, sendMail } from "../src/services/mail";

describe("MailService (nodemailer mock — real SMTP'ga ulanmaydi)", () => {
  afterEach(() => {
    for (const k of Object.keys(smtp)) delete smtp[k];
    sentMails.length = 0;
  });

  it("SMTP sozlanmagan — xat yuborilmaydi, false", async () => {
    expect(await sendMail({ to: "a@test.uz", subject: "s", text: "t", html: "h" })).toBe(false);
    expect(sentMails).toHaveLength(0);
  });

  it("SMTP sozlangan — xat soxta transport orqali ketadi", async () => {
    Object.assign(smtp, { SMTP_HOST: "smtp.example.uz", SMTP_PORT: 465, SMTP_USER: "u@example.uz", MAIL_FROM: "Bot <no-reply@example.uz>" });
    expect(await sendMail(passwordResetEmail("admin@test.uz", "Ali <b>", "012345", 10))).toBe(true);
    expect(sentMails).toHaveLength(1);
    const m = sentMails[0];
    expect(m).toMatchObject({ to: "admin@test.uz", from: "Bot <no-reply@example.uz>", subject: "Admin panelga kirish kodi" });
    expect(String(m.html)).toContain("012345");
    expect(String(m.html)).toContain("Ali &lt;b&gt;"); // ism escape qilingan
    expect(String(m.html)).toContain("10 daqiqa");
    expect(String(m.text)).toContain("Agar siz so'ramagan bo'lsangiz, bu xatni e'tiborsiz qoldiring");
  });
});
