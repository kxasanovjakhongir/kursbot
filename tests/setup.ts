import { vi } from "vitest";

/**
 * Testlarda real SMTP'ga ulanish taqiqlangan: nodemailer transporti soxta. Yuborilgan xatlar
 * `testMailbox()` da (yoki services/mail.ts → setMailSender bilan o'z ushlagichingizni bering).
 */
export interface TestMail {
  from?: unknown;
  to?: unknown;
  subject?: unknown;
  text?: unknown;
  html?: unknown;
}

const store = globalThis as typeof globalThis & { __testMailbox?: TestMail[] };
store.__testMailbox ??= [];
export const testMailbox = (): TestMail[] => store.__testMailbox!;

vi.mock("nodemailer", () => {
  const createTransport = () => ({
    sendMail: async (message: TestMail) => {
      (globalThis as typeof globalThis & { __testMailbox: TestMail[] }).__testMailbox.push(message);
      return { messageId: "test" };
    },
    verify: async () => true,
  });
  return { default: { createTransport }, createTransport };
});
