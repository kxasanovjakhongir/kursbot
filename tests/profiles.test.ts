import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { prisma } from "../src/db";
import { createBot } from "../src/bot/bot";
import type { BotContext } from "../src/bot/context";
import { addCard } from "../src/services/cards";
import { invalidateSettings } from "../src/services/settings";
import { invalidateTexts } from "../src/i18n";

/**
 * Test foydalanuvchi profillari va chegaraviy holatlar: bot har biriga qulamasdan, to'g'ri javob beradimi.
 * Telegram soxta (tarmoqqa chiqilmaydi), baza — alohida test bazasi.
 */
const enabled = !!process.env.TEST_DATABASE_URL;
const BOT_INFO: UserFromGetMe = {
  id: 42,
  is_bot: true,
  first_name: "Test",
  username: "test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

const calls: { method: string; payload: Record<string, unknown> }[] = [];
let seq = 0;
let updateId = 5000;

interface Tg {
  id: number;
  first_name: string;
  language_code?: string;
  username?: string;
}

function makeBot(): Bot<BotContext> {
  const bot = createBot("123:test-token", { botInfo: BOT_INFO });
  bot.api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    const result = method.startsWith("send") || method === "editMessageText" ? { message_id: ++seq, date: 0, chat: { id: Number(p.chat_id), type: "private" }, text: p.text } : true;
    return { ok: true, result } as unknown as Awaited<ReturnType<typeof _prev>>;
  });
  return bot;
}

const from = (u: Tg) => ({ is_bot: false as const, ...u });
const chat = (u: Tg) => ({ id: u.id, type: "private" as const, first_name: u.first_name });
function text(u: Tg, t: string, id = updateId++): Update {
  const cmd = t.startsWith("/") ? [{ type: "bot_command" as const, offset: 0, length: t.split(" ")[0].length }] : undefined;
  return { update_id: id, message: { message_id: ++seq, date: 0, chat: chat(u), from: from(u), text: t, entities: cmd } };
}
function cb(u: Tg, data: string): Update {
  return { update_id: updateId++, callback_query: { id: String(updateId), from: from(u), chat_instance: "ci", data, message: { message_id: 1, date: 0, chat: chat(u), text: "x" } } };
}
function contact(u: Tg, phone: string): Update {
  return { update_id: updateId++, message: { message_id: ++seq, date: 0, chat: chat(u), from: from(u), contact: { phone_number: phone, first_name: u.first_name, user_id: u.id } } };
}
const sentTo = (id: number) => calls.filter((c) => (c.method === "sendMessage" || c.method === "editMessageText") && Number(c.payload.chat_id) === id).map((c) => String(c.payload.text ?? ""));

describe.skipIf(!enabled)("test foydalanuvchi profillari va chegaraviy holatlar", () => {
  let bot: Bot<BotContext>;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE bot_state, events, messages, notifications, receipts, access_grants, orders, cards, products, admins, settings, texts, users RESTART IDENTITY CASCADE`,
    );
    invalidateSettings();
    invalidateTexts();
    await prisma.product.create({ data: { code: "4b", title: "Darslik 4b", price: 100_000, channelId: -1001n } });
    await addCard("8600123412341234", "A. Karimov");
    bot = makeBot();
    await bot.init();
  });
  beforeEach(() => {
    calls.length = 0;
  });
  afterAll(() => prisma.$disconnect());

  it("1. yangi foydalanuvchi: /start → bazada yaratiladi va telefon so'raladi", async () => {
    const u = { id: 7101, first_name: "Yangi", language_code: "uz" };
    await bot.handleUpdate(text(u, "/start"));
    expect(await prisma.user.findUnique({ where: { telegramId: 7101n } })).not.toBeNull();
    expect(sentTo(7101).join("\n")).toMatch(/telefon/i);
  });

  it("9. to'liq bo'lmagan ma'lumot (telefonsiz) — sotib olishga urinsa buyurtma ochilmaydi, telefon so'raladi", async () => {
    const u = { id: 7102, first_name: "Telefonsiz" };
    await bot.handleUpdate(text(u, "/start"));
    await bot.handleUpdate(cb(u, "buy:4b"));
    expect(await prisma.order.count({ where: { user: { telegramId: 7102n } } })).toBe(0);
  });

  it("2–3. oddiy va faol foydalanuvchi: telefon → darslik → buyurtma", async () => {
    const u = { id: 7103, first_name: "Faol" };
    await bot.handleUpdate(text(u, "/start 4b"));
    await bot.handleUpdate(contact(u, "+998901234567"));
    await bot.handleUpdate(cb(u, "buy:4b"));
    expect(await prisma.order.count({ where: { user: { telegramId: 7103n } } })).toBe(1);
  });

  it("takroriy update (Telegram qayta yubordi) va bir vaqtdagi bosishlar — buyurtma ikki marta ochilmaydi", async () => {
    const u = { id: 7104, first_name: "Shoshqaloq" };
    await bot.handleUpdate(text(u, "/start"));
    await bot.handleUpdate(contact(u, "+998901112233"));
    const dup = cb(u, "buy:4b");
    await Promise.all([bot.handleUpdate(dup), bot.handleUpdate(dup), bot.handleUpdate(cb(u, "buy:4b")), bot.handleUpdate(cb(u, "buy:4b"))]);
    expect(await prisma.order.count({ where: { user: { telegramId: 7104n } } })).toBe(1);
  });

  it("5. spam foydalanuvchi: 10 soniyada 20 tadan ortig'i qayta ishlanmaydi, ogohlantirish bir marta", async () => {
    const u = { id: 7105, first_name: "Spam" };
    for (let i = 0; i < 40; i++) await bot.handleUpdate(text(u, `spam ${i}`));
    const incoming = await prisma.message.count({ where: { user: { telegramId: 7105n }, direction: "incoming" } });
    const { flushMessageLog } = await import("../src/bot/messageLog.js");
    await flushMessageLog();
    const logged = await prisma.message.count({ where: { user: { telegramId: 7105n }, direction: "incoming" } });
    expect(logged).toBeLessThanOrEqual(20);
    expect(incoming).toBeLessThanOrEqual(20);
    expect(sentTo(7105).filter((t) => /ko'p|много|many/i.test(t))).toHaveLength(1);
  });

  it("7. ruxsatsiz foydalanuvchi: admin buyruqlari va tugmalari ishlamaydi", async () => {
    const u = { id: 7106, first_name: "Begona" };
    for (const t of ["/admin", "/pending", "/addadmin 7106 super", "/stats"]) await bot.handleUpdate(text(u, t));
    for (const d of ["ap:home", "ap:admins", "adm:ad:n:7106:s", "adm:ap:1"]) await bot.handleUpdate(cb(u, d));
    expect(await prisma.admin.count()).toBe(0);
    expect(sentTo(7106).join("\n")).not.toMatch(/Adminlar|Kutilayotgan cheklar/);
  });

  it("8. chegaraviy foydalanuvchi: emoji, RTL, nol-kenglikdagi belgilar, 4096 belgilik matn", async () => {
    const u = { id: 7107, first_name: "🦄 ‮عربي‬ ​Ali 👨‍👩‍👧", username: "x".repeat(32) };
    await bot.handleUpdate(text(u, "/start"));
    await bot.handleUpdate(text(u, "a".repeat(4096)));
    await bot.handleUpdate(text(u, "😀🇺🇿 Salom! Привет! Hello! ‏שלום"));
    await bot.handleUpdate(text(u, " "));
    const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: 7107n } });
    expect(user.firstName).toBe(u.first_name);
    expect(sentTo(7107).length).toBeGreaterThan(0);
  });

  it("til: yangi foydalanuvchiga standart til (sozlama); o'zi tanlagan til (ru/en) hurmat qilinadi", async () => {
    // Loyiha qarori: Telegram language_code emas, admin paneldagi standart til (uz) — foydalanuvchi keyin o'zi tanlaydi
    await bot.handleUpdate(text({ id: 7109, first_name: "John", language_code: "en" }, "/start"));
    expect(sentTo(7109).join("\n")).toMatch(/telefon/i);
    await bot.handleUpdate(text({ id: 7110, first_name: "X", language_code: "zz" }, "/start"));
    expect(sentTo(7110).join("\n")).toMatch(/telefon/i);

    await prisma.user.update({ where: { telegramId: 7109n }, data: { language: "en" } });
    await prisma.user.create({ data: { telegramId: 7108n, firstName: "Ivan", language: "ru" } });
    calls.length = 0;
    await bot.handleUpdate(text({ id: 7109, first_name: "John", language_code: "en" }, "/start"));
    await bot.handleUpdate(text({ id: 7108, first_name: "Ivan", language_code: "ru" }, "/start"));
    expect(sentTo(7109).join("\n")).toMatch(/phone/i);
    expect(sentTo(7108).join("\n")).toMatch(/телефон/i);
  });

  it("o'chirilgan foydalanuvchi: yozuvi bazadan o'chsa, keyingi tugmada qayta yaratiladi (qulamaydi)", async () => {
    const u = { id: 7111, first_name: "Qaytgan" };
    await bot.handleUpdate(text(u, "/start"));
    const { flushMessageLog } = await import("../src/bot/messageLog.js");
    await flushMessageLog();
    await prisma.$executeRaw`DELETE FROM events WHERE user_id IN (SELECT id FROM users WHERE telegram_id = 7111)`;
    await prisma.$executeRaw`DELETE FROM messages WHERE user_id IN (SELECT id FROM users WHERE telegram_id = 7111)`;
    await prisma.user.delete({ where: { telegramId: 7111n } });
    calls.length = 0;
    await bot.handleUpdate(cb(u, "nav:home"));
    expect(await prisma.user.findUnique({ where: { telegramId: 7111n } })).not.toBeNull();
    expect(sentTo(7111).length).toBeGreaterThan(0);
  });

  it("10. katta hajmli foydalanuvchi: 150 buyurtma va 300 bildirishnoma — sahifalash ishlaydi, tez javob", async () => {
    const u = { id: 7112, first_name: "Katta" };
    await bot.handleUpdate(text(u, "/start"));
    const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: 7112n } });
    const product = await prisma.product.findUniqueOrThrow({ where: { code: "4b" } });
    await prisma.order.createMany({
      data: Array.from({ length: 150 }, () => ({ userId: user.id, productId: product.id, amount: 100_000, status: "cancelled" as const, expiresAt: new Date() })),
    });
    await prisma.notification.createMany({ data: Array.from({ length: 300 }, (_, i) => ({ userId: user.id, kind: "info" as const, text: `xabar ${i}` })) });
    calls.length = 0;
    const t0 = Date.now();
    await bot.handleUpdate(cb(u, "nav:pur:1"));
    await bot.handleUpdate(cb(u, "nav:notif:3"));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(sentTo(7112).length).toBe(2);
  });
});
