import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Api } from "grammy";
import { prisma } from "../src/db";
import { invalidateSettings, normalizeSupportPhone } from "../src/services/settings";
import { isReminderHour, nextPayReminder, processReminders, REMINDER_RULES } from "../src/services/reminders";

const enabled = !!process.env.TEST_DATABASE_URL;
const HOUR = 3600_000;
// Toshkent vaqti bilan 12:00 (UTC+5)
const NOON = new Date("2026-11-24T07:00:00Z");
const at = (ms: number) => new Date(NOON.getTime() + ms);

describe("eslatmalar: vaqt va to'lov eslatmasi navbati", () => {
  it("faqat 09:00–22:00 (Toshkent) yuboriladi", () => {
    expect(isReminderHour(NOON)).toBe(true);
    expect(isReminderHour(new Date("2026-11-24T03:59:00Z"))).toBe(false); // 08:59
    expect(isReminderHour(new Date("2026-11-24T04:00:00Z"))).toBe(true); // 09:00
    expect(isReminderHour(new Date("2026-11-24T16:59:00Z"))).toBe(true); // 21:59
    expect(isReminderHour(new Date("2026-11-24T17:00:00Z"))).toBe(false); // 22:00
  });

  it("to'lov eslatmalari: 1 soatdan, ~1 kundan keyin va muddat tugashidan oldin", () => {
    const order = { createdAt: NOON, expiresAt: at(72 * HOUR) };
    expect(nextPayReminder(order, {}, at(30 * 60_000))).toBeNull();
    expect(nextPayReminder(order, {}, at(HOUR))).toBe("pay_1");
    expect(nextPayReminder(order, { pay_1: at(HOUR) }, at(10 * HOUR))).toBeNull();
    expect(nextPayReminder(order, { pay_1: at(HOUR) }, at(24 * HOUR))).toBe("pay_2");
    expect(nextPayReminder(order, { pay_1: at(HOUR), pay_2: at(24 * HOUR) }, at(40 * HOUR))).toBeNull();
    expect(nextPayReminder(order, { pay_1: at(HOUR), pay_2: at(24 * HOUR) }, at(62 * HOUR))).toBe("pay_3");
    expect(nextPayReminder(order, { pay_1: at(HOUR), pay_2: at(24 * HOUR), pay_3: at(62 * HOUR) }, at(65 * HOUR))).toBeNull();
    // Muddati deyarli tugagan — endi yozilmaydi
    expect(nextPayReminder(order, {}, at(71.7 * HOUR))).toBeNull();
    // Oxirgi eslatma oldingisidan keyin juda tez emas
    expect(nextPayReminder(order, { pay_1: at(HOUR), pay_2: at(60 * HOUR) }, at(62 * HOUR))).toBeNull();
    // Eski buyurtma: 1-eslatma kechikib borgan — boshqasi yo'q (odam bitta eslatma oladi)
    expect(nextPayReminder(order, { pay_1: at(30 * HOUR) }, at(55 * HOUR))).toBeNull();
    expect(nextPayReminder(order, { pay_1: at(30 * HOUR) }, at(62 * HOUR))).toBeNull();
  });
});

describe("bot yuboradigan raqam (sozlamalar)", () => {
  it("odatiy yozuvlar qabul qilinadi, noto'g'risi — yo'q", () => {
    expect(normalizeSupportPhone("  +998 90   123 45 67 ")).toBe("+998 90 123 45 67");
    expect(normalizeSupportPhone("(90) 123-45-67")).toBe("(90) 123-45-67");
    expect(normalizeSupportPhone("998901234567")).toBe("998901234567");
    expect(normalizeSupportPhone("12345")).toBeNull();
    expect(normalizeSupportPhone("+998 90 abc")).toBeNull();
    expect(normalizeSupportPhone("<b>+998901234567</b>")).toBeNull();
  });
});

interface Sent {
  chatId: number;
  text: string;
  markup: unknown;
}
const sent: Sent[] = [];
const fakeApi = {
  token: "test",
  sendMessage: async (chatId: number, text: string, other?: { reply_markup?: unknown }) => {
    sent.push({ chatId, text, markup: other?.reply_markup });
    return { message_id: sent.length, chat: { id: chatId } };
  },
} as unknown as Api;

describe.skipIf(!enabled)("eslatmalar: kimga va qachon yuboriladi", () => {
  let orderId = 0n;
  const to = (tg: number) => sent.filter((s) => s.chatId === tg);
  const json = (v: unknown) => JSON.stringify(v);

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE reminders, orders, products, users RESTART IDENTITY CASCADE`);
    await prisma.setting.upsert({ where: { key: "support_username" }, create: { key: "support_username", value: "verda_admin" }, update: { value: "verda_admin" } });
    await prisma.setting.upsert({ where: { key: "support_phone" }, create: { key: "support_phone", value: "+998 90 123 45 67" }, update: { value: "+998 90 123 45 67" } });
    invalidateSettings();
    const [fourStep, rules] = await Promise.all([
      prisma.product.create({ data: { code: "r4", title: "1. Kompaniyani 4 bosqichda boshqarish", price: 100 } }),
      prisma.product.create({ data: { code: "rq", title: "2. Kompaniyani ichki qonun qoidalari", price: 100 } }),
    ]);
    const user = (telegramId: bigint, data: Record<string, unknown>) => prisma.user.create({ data: { telegramId, firstName: "Ali", ...data } });
    await user(9001n, { lastProduct: "rq", lastSeenAt: at(-2 * HOUR) }); // qoida: telefon bermagan
    await user(9002n, { lastProduct: "rq", lastSeenAt: at(-30 * 60_000) }); // hali botda (yarim soat)
    await user(9003n, { phone: "+998901112233", lastProduct: "r4", lastSeenAt: at(-25 * HOUR) }); // videoni ko'rgan
    const payer = await user(9004n, { phone: "+998901112244", lastProduct: "rq", lastSeenAt: at(-2 * HOUR) });
    await user(9005n, { lastProduct: "r4", lastSeenAt: at(-20 * 24 * HOUR) }); // juda eski
    await user(9008n, { lastProduct: "r4", lastSeenAt: at(-30 * HOUR) }); // kecha kirgan (eski odam) — bitta eslatma
    await user(9009n, { lastProduct: "r4", lastSeenAt: at(-8 * 24 * HOUR) }); // bir haftadan ko'p botga kirmagan
    await user(9010n, { lastProduct: "r4", lastSeenAt: at(-2 * HOUR), createdAt: new Date("2026-11-20T10:00:00Z") }); // sotuvdan oldin (o'zimizning odam)
    await user(9006n, { lastProduct: "r4", lastSeenAt: at(-2 * HOUR), isBlocked: true });
    await user(9007n, { lastProduct: "r4", lastSeenAt: at(-2 * HOUR), newsEnabled: false });
    const order = await prisma.order.create({
      data: { userId: payer.id, productId: rules.id, amount: 100, status: "new", createdAt: at(-2 * HOUR), expiresAt: at(70 * HOUR) },
    });
    orderId = order.id;
    // Ikkinchi kursga ham ochiq buyurtma — baribir bitta xabar
    await prisma.order.create({
      data: { userId: payer.id, productId: fourStep.id, amount: 100, status: "new", createdAt: at(-90 * 60_000), expiresAt: at(70 * HOUR) },
    });
  });

  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { key: { in: ["support_username", "support_phone"] } } });
    invalidateSettings();
  });

  it("kechasi hech kimga yozilmaydi", async () => {
    expect(await processReminders(fakeApi, new Date("2026-11-24T18:00:00Z"))).toEqual({ pay: 0, phone: 0, upsell: 0 });
    expect(sent).toHaveLength(0);
  });

  it("har biriga o'z kursi bo'yicha eslatma va admin lichkasi", async () => {
    expect(await processReminders(fakeApi, NOON)).toEqual({ pay: 1, phone: 2, upsell: 1 });
    expect(sent.map((s) => s.chatId).sort()).toEqual([9001, 9003, 9004, 9008]);

    const [phone] = to(9001);
    expect(phone.text).toContain("qonun qoidalari");
    expect(phone.text).toContain("@verda_admin");
    expect(phone.text).toContain("+998 90 123 45 67");
    expect(phone.text).toContain("Savolingiz bo'lsa");
    expect(json(phone.markup)).toContain("request_contact");

    const [upsell] = to(9003);
    expect(upsell.text).toContain("4 bosqichda");
    expect(upsell.text).toContain("Qanday savolingiz bor");
    expect(upsell.text).toContain("+998 90 123 45 67");
    expect(json(upsell.markup)).toContain('"p:r4"');
    expect(json(upsell.markup)).not.toContain('"buy:r4"');
    expect(json(upsell.markup)).toContain("https://t.me/verda_admin");

    const [pay] = to(9004);
    expect(pay.text).toContain("qonun qoidalari");
    expect(json(pay.markup)).toContain(`"pay:${orderId}"`);
  });

  it("takror yuborilmaydi; ~1 kundan keyin ikkinchi eslatma", async () => {
    expect(await processReminders(fakeApi, at(10 * 60_000))).toEqual({ pay: 0, phone: 0, upsell: 0 });
    const next = at(24 * HOUR);
    // 9001 — 2-eslatma; 9002 (endi 1 soatdan ko'p jim) — 1-eslatma
    expect(await processReminders(fakeApi, next)).toEqual({ pay: 1, phone: 2, upsell: 0 });
    expect(to(9001)).toHaveLength(2);
    expect(to(9002)).toHaveLength(1);
    expect(to(9005).length + to(9006).length + to(9007).length + to(9009).length + to(9010).length).toBe(0);
    expect(to(9008)).toHaveLength(1); // eski odam — faqat bitta eslatma
    expect(to(9003)).toHaveLength(1); // «darslikni oling» — bir marta
    expect(await prisma.reminder.count({ where: { sentAt: { not: null } } })).toBe(7);
  });

  it("odam qadamni bajarsa (raqam bersa, to'lasa) — boshqa eslatma yo'q", async () => {
    // To'ladi (ikkinchi kursdan esa voz kechdi)
    await prisma.order.update({ where: { id: orderId }, data: { status: "approved" } });
    await prisma.order.updateMany({ where: { status: "new" }, data: { status: "cancelled" } });
    // To'lov eslatmasining oxirgisi vaqti keldi, lekin buyurtma to'langan
    expect((await processReminders(fakeApi, at(62 * HOUR))).pay).toBe(0);
    expect(to(9004)).toHaveLength(2);
    expect(REMINDER_RULES.minGapMs).toBeGreaterThan(0);
  });
});
