import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { prisma } from "../src/db";
import { createBot } from "../src/bot/bot";
import type { BotContext } from "../src/bot/context";
import { addCard } from "../src/services/cards";
import { invalidateSettings, setSetting } from "../src/services/settings";
import { invalidateTexts } from "../src/i18n";
import { uz } from "../src/i18n/locales/uz";
import { ru } from "../src/i18n/locales/ru";

const enabled = !!process.env.TEST_DATABASE_URL;

// ---------- Soxta Telegram: bot API chaqiruvlarini yozib boradi, tarmoqqa chiqmaydi ----------

interface Call {
  method: string;
  payload: Record<string, unknown>;
}

const BOT_INFO = {
  id: 42,
  is_bot: true,
  first_name: "Test bot",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as UserFromGetMe;

let calls: Call[] = [];
let seq = 1000;
/** Keyingi sendMessage xato bilan tugaydi (xato ushlagichni tekshirish uchun) */
let failNextSend = false;

function fakeResult(method: string, payload: Record<string, unknown>): unknown {
  const message = () => ({
    message_id: ++seq,
    date: Math.floor(Date.now() / 1000),
    chat: { id: Number(payload.chat_id), type: "private" },
    text: typeof payload.text === "string" ? payload.text : undefined,
  });
  switch (method) {
    case "sendMessage":
    case "sendVideo":
    case "sendPhoto":
    case "sendDocument":
      return message();
    case "editMessageText":
      return { ...message(), message_id: Number(payload.message_id) };
    case "getMe":
      return BOT_INFO;
    case "createChatInviteLink":
      return { invite_link: `https://t.me/+t${++seq}` };
    default:
      return true;
  }
}

function makeBot(): Bot<BotContext> {
  const bot = createBot("123:test-token", { botInfo: BOT_INFO });
  bot.api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    if (failNextSend && method === "sendMessage") {
      failNextSend = false;
      throw new Error("soxta tarmoq xatosi");
    }
    return { ok: true, result: fakeResult(method, p) } as unknown as Awaited<ReturnType<typeof _prev>>;
  });
  return bot;
}

// ---------- Update yasash ----------

interface TgUser {
  id: number;
  is_bot: false;
  first_name: string;
  language_code?: string;
  username?: string;
}

const AZIZ: TgUser = { id: 5001, is_bot: false, first_name: "Aziz", language_code: "uz", username: "aziz" };
const ADMIN: TgUser = { id: 9001, is_bot: false, first_name: "Admin" };
let updateId = 1;
const now = () => Math.floor(Date.now() / 1000);
const chatOf = (u: TgUser) => ({ id: u.id, type: "private" as const, first_name: u.first_name });

function text(t: string, from: TgUser = AZIZ): Update {
  const cmd = t.startsWith("/") ? [{ type: "bot_command" as const, offset: 0, length: t.split(" ")[0].length }] : undefined;
  return { update_id: updateId++, message: { message_id: ++seq, date: now(), chat: chatOf(from), from, text: t, entities: cmd } };
}

function contact(phone: string, from: TgUser = AZIZ): Update {
  return {
    update_id: updateId++,
    message: { message_id: ++seq, date: now(), chat: chatOf(from), from, contact: { phone_number: phone, first_name: from.first_name, user_id: from.id } },
  };
}

function callback(data: string, from: TgUser = AZIZ): Update {
  return {
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from,
      chat_instance: "ci",
      data,
      message: { message_id: 77, date: now(), chat: chatOf(from), from: BOT_INFO, text: "oldingi ekran" },
    },
  };
}

// ---------- Tekshiruv yordamchilari ----------

const sent = () => calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText");
const lastScreen = () => sent().at(-1)!;
const textOf = (c: Call) => String(c.payload.text ?? "");
const answers = () => calls.filter((c) => c.method === "answerCallbackQuery");

interface Button {
  text: string;
  callback_data?: string;
  url?: string;
  copy_text?: { text: string };
  web_app?: { url: string };
}
function buttons(c: Call): Button[] {
  const markup = c.payload.reply_markup as { inline_keyboard?: Button[][]; keyboard?: { text: string }[][] } | undefined;
  if (markup?.inline_keyboard) return markup.inline_keyboard.flat();
  return (markup?.keyboard ?? []).flat().map((b) => ({ text: b.text }));
}
const hasButton = (c: Call, data: string) => buttons(c).some((b) => b.callback_data === data);

async function reset() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE notifications, broadcast_recipients, broadcasts, events, audit_log, messages, reminders, access_grants, receipts, orders, promo_codes, cards, products, admins, settings, texts, users RESTART IDENTITY CASCADE`,
  );
  invalidateSettings();
  invalidateTexts();
  await prisma.product.createMany({
    data: [
      { code: "4b", title: "4 bosqichli", price: 1_250_000, channelId: -1001n, sortOrder: 1 },
      { code: "qd", title: "Qoidalar", price: 800_000, channelId: -1002n, sortOrder: 2 },
    ],
  });
  await addCard("8600123412341234", "A. Karimov");
  await prisma.admin.create({ data: { telegramId: BigInt(ADMIN.id), role: "admin", name: "Admin" } });
  calls = [];
}

describe.skipIf(!enabled)("bot oqimlari (integratsion)", () => {
  let bot: Bot<BotContext>;
  beforeEach(async () => {
    await reset();
    bot = makeBot();
  });
  afterAll(() => prisma.$disconnect());

  const send = async (...updates: Update[]) => {
    for (const u of updates) await bot.handleUpdate(u);
  };

  it("/start: yangi foydalanuvchi yaratiladi, telefon so'raladi, keyin salomlashuv va darsliklar", async () => {
    await send(text("/start"));
    const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(AZIZ.id) } });
    expect(user.firstName).toBe("Aziz");
    expect(textOf(lastScreen())).toContain("telefon raqamingizni yuboring");
    expect(buttons(lastScreen())[0].text).toBe(uz.phone_button);

    calls = [];
    await send(contact("+998 90 123 45 67"));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).phone).toBe("+998901234567");
    const menu = sent()[0];
    expect(buttons(menu).map((b) => b.text)).toEqual([uz.menu_products, uz.menu_help]);
    expect(textOf(lastScreen())).toContain("Darsliklar");
    expect(hasButton(lastScreen(), "p:4b")).toBe(true);
    // Mini App olib tashlangan: hech qanday web_app tugmasi yo'q
    expect(buttons(lastScreen()).some((b) => b.web_app)).toBe(false);

    calls = [];
    await send(text("/start"));
    expect(textOf(sent()[0])).toContain("Qaytganingizdan xursandmiz, Aziz");
  });

  it("profil: yuklanish holati, keyin ma'lumotlar bilan tahrirlanadi; orqaga va bosh menyu bor", async () => {
    await send(text("/start"), contact("+998901234567"));
    calls = [];
    await send(text(uz.menu_profile));
    expect(textOf(sent()[0])).toBe(uz.loading);
    const profile = lastScreen();
    expect(profile.method).toBe("editMessageText");
    expect(textOf(profile)).toContain(String(AZIZ.id));
    expect(textOf(profile)).toContain("+998 90 123 45 67");
    expect(hasButton(profile, "nav:home")).toBe(true);
    expect(hasButton(profile, "set:phone")).toBe(true);
  });

  it("til: ruschaga o'tadi, menyu yangi tilda, ruscha tugma ham ishlaydi", async () => {
    await send(text("/start"), contact("+998901234567"));
    calls = [];
    await send(callback("set:lang:ru"));
    expect((await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(AZIZ.id) } })).language).toBe("ru");
    expect(textOf(sent()[0])).toContain("Настройки");
    const confirm = lastScreen();
    expect(textOf(confirm)).toBe(ru.language_changed);
    expect(buttons(confirm)[0].text).toBe(ru.menu_products);

    calls = [];
    await send(text(ru.menu_products));
    expect(textOf(lastScreen())).toContain("Учебники");
  });

  it("yangiliklar obunasini o'chirish/yoqish", async () => {
    await send(text("/start"), contact("+998901234567"));
    await send(callback("set:news"));
    expect((await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(AZIZ.id) } })).newsEnabled).toBe(false);
    await send(callback("set:news"));
    expect((await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(AZIZ.id) } })).newsEnabled).toBe(true);
  });

  it("buyurtma: to'lov ma'lumoti (karta nusxalash), bekor qilish tasdiq bilan", async () => {
    await send(text("/start"), contact("+998901234567"));
    calls = [];
    await send(callback("buy:4b"));
    const pay = lastScreen();
    expect(pay.method).toBe("sendMessage");
    expect(textOf(pay)).toContain("1 250 000 so'm");
    expect(buttons(pay).find((b) => b.copy_text)?.copy_text?.text).toBe("8600123412341234");
    const order = await prisma.order.findFirstOrThrow();
    expect(hasButton(pay, `ord:cancel:${order.id}`)).toBe(true);

    await send(callback(`ord:cancel:${order.id}`));
    expect(textOf(lastScreen())).toContain(`#${order.id}`);
    expect(hasButton(lastScreen(), `ord:cancel_ok:${order.id}`)).toBe(true);
    // "Yo'q" — to'lov ekraniga qaytadi, buyurtma o'zgarmaydi
    expect(hasButton(lastScreen(), `pay:${order.id}`)).toBe(true);

    await send(callback(`ord:cancel_ok:${order.id}`));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("cancelled");
    // Ikkinchi marta — bekor qilib bo'lmaydi
    calls = [];
    await send(callback(`ord:cancel_ok:${order.id}`));
    expect(answers().at(-1)?.payload.show_alert).toBe(true);
  });

  it("boshqa odamning buyurtmasini ko'rib/bekor qilib bo'lmaydi", async () => {
    const other: TgUser = { id: 5002, is_bot: false, first_name: "Vali" };
    await send(text("/start"), contact("+998901234567"), callback("buy:4b"));
    const order = await prisma.order.findFirstOrThrow();
    await send(text("/start", other), contact("+998907654321", other));
    calls = [];
    await send(callback(`ord:cancel_ok:${order.id}`, other), callback(`pay:${order.id}`, other));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("new");
    expect(sent()).toHaveLength(0);
  });

  it("pagination: 10 dan ortiq darslik sahifalarga bo'linadi", async () => {
    await prisma.product.createMany({
      data: Array.from({ length: 9 }, (_, i) => ({ code: `x${i}`, title: `Darslik ${i}`, price: 1000, sortOrder: 10 + i })),
    });
    await send(text("/start"), contact("+998901234567"));
    const first = lastScreen();
    expect(hasButton(first, "nav:cat:2")).toBe(true);
    await send(callback("nav:cat:2"));
    const second = lastScreen();
    expect(buttons(second).some((b) => b.text === "2 / 2")).toBe(true);
    expect(hasButton(second, "nav:cat:1")).toBe(true);
  });

  it("noma'lum buyruq va eskirgan tugma — tushunarli javob", async () => {
    await send(text("/start"), contact("+998901234567"));
    calls = [];
    await send(text("/nimadir"));
    expect(textOf(lastScreen())).toBe(uz.error_unknown_command);
    await send(callback("eski:tugma"));
    expect(answers().at(-1)?.payload).toMatchObject({ text: uz.error_stale_button, show_alert: true });
  });

  it("xato: foydalanuvchiga texnik tafsilotsiz xabar, bot ishlashda davom etadi", async () => {
    await send(text("/start"), contact("+998901234567"));
    calls = [];
    failNextSend = true;
    await send(text("/help"));
    expect(textOf(lastScreen())).toBe(uz.error_generic);
    calls = [];
    await send(text("/help"));
    expect(textOf(lastScreen())).toContain("Yordam");
  });

  it("admin: /admin paneli, statistika; oddiy foydalanuvchiga ruxsat yo'q", async () => {
    await send(text("/admin", ADMIN));
    const home = lastScreen();
    expect(textOf(home)).toContain("Admin panel");
    expect(hasButton(home, "ap:stats")).toBe(true);
    // ADMIN roli super admin bo'limlarini ko'rmaydi
    expect(hasButton(home, "ap:products")).toBe(false);
    expect(hasButton(home, "ap:admins")).toBe(false);

    await send(callback("ap:stats", ADMIN));
    expect(textOf(lastScreen())).toContain("Statistika");

    await send(text("/start"), contact("+998901234567"));
    calls = [];
    await send(callback("ap:stats"));
    expect(answers().at(-1)?.payload.show_alert).toBe(true);
    expect(sent()).toHaveLength(0);
    // Admin tugmasi oddiy foydalanuvchi menyusida yo'q
    await send(text("/start"));
    expect(buttons(sent()[0]).some((b) => b.text === uz.menu_admin)).toBe(false);
  });

  it("cheklangan foydalanuvchi: bir marta ogohlantiriladi, handlerlarga o'tmaydi", async () => {
    await send(text("/start"), contact("+998901234567"));
    await prisma.user.update({ where: { telegramId: BigInt(AZIZ.id) }, data: { isBanned: true } });
    calls = [];
    await send(text("/start"), text(uz.menu_products));
    expect(sent()).toHaveLength(1);
    expect(textOf(sent()[0])).toBe(uz.error_banned);
  });

  it("maintenance: foydalanuvchi to'xtatiladi, admin ishlaydi", async () => {
    await send(text("/start"), contact("+998901234567"));
    await setSetting("maintenance_mode", true);
    calls = [];
    await send(text(uz.menu_products));
    expect(textOf(lastScreen())).toBe(uz.maintenance);
    await send(text("/admin", ADMIN));
    expect(textOf(lastScreen())).toContain("Admin panel");
    await setSetting("maintenance_mode", false);
  });

  it("spam himoyasi: limitdan oshgan update lar tashlanadi, ogohlantirish bir marta", async () => {
    await send(text("/start"), contact("+998901234567"));
    calls = [];
    for (let i = 0; i < 25; i++) await send(text(uz.menu_help));
    const warnings = sent().filter((c) => textOf(c) === uz.error_too_many);
    expect(warnings).toHaveLength(1);
    expect(sent().filter((c) => textOf(c).includes("Yordam")).length).toBeLessThanOrEqual(20);
  });
});
