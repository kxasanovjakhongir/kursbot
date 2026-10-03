import { describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import { Prisma } from "@prisma/client";

// Migratsiya qo'llanmagan baza: support_button_messages jadvali yo'q (Prisma P2021)
const missing = () => new Prisma.PrismaClientKnownRequestError("The table `public.support_button_messages` does not exist", { code: "P2021", clientVersion: "test" });
const db = vi.hoisted(() => ({ findMany: vi.fn(), deleteMany: vi.fn() }));
vi.mock("../src/db", () => ({ prisma: { supportButtonMessage: db } }));
vi.mock("../src/services/settings", () => ({ getSupportUrl: async () => "https://t.me/support" }));
const warn = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/logger", () => ({ logger: { warn, info: vi.fn(), error: vi.fn() } }));

import { purgeOldSupportButtons, syncSupportButtons } from "../src/services/supportButtons";

describe("support tugmalari: jadval yo'q bo'lsa", () => {
  it("fon vazifasi xato tashlamaydi, ogohlantirish bir marta yoziladi", async () => {
    db.findMany.mockRejectedValue(missing());
    db.deleteMany.mockRejectedValue(missing());
    const api = {} as Api;
    for (let i = 0; i < 3; i++) await expect(syncSupportButtons(api)).resolves.toBe(0);
    await expect(purgeOldSupportButtons()).resolves.toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("prisma migrate deploy");
  });

  it("boshqa xatolar yashirilmaydi", async () => {
    db.findMany.mockRejectedValue(new Error("connection refused"));
    await expect(syncSupportButtons({} as Api)).rejects.toThrow("connection refused");
  });
});
