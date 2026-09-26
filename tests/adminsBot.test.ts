import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { prisma } from "../src/db";
import { createBot } from "../src/bot/bot";
import type { BotContext } from "../src/bot/context";
import { AdminChangeError, revokeAdmin, setAdminRole } from "../src/services/admins";
import { invalidateSettings } from "../src/services/settings";

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

interface Call {
  method: string;
  payload: Record<string, unknown>;
}
const calls: Call[] = [];
let seq = 0;
let updateId = 1;

const SUPER = { id: 8001, first_name: "Boss" };
const HELPER = { id: 8002, first_name: "Yordamchi" };

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

const chat = (u: { id: number; first_name: string }) => ({ id: u.id, type: "private" as const, first_name: u.first_name });
const from = (u: { id: number; first_name: string }) => ({ ...u, is_bot: false as const, language_code: "uz" });

function text(t: string, u = SUPER): Update {
  const cmd = t.startsWith("/") ? [{ type: "bot_command" as const, offset: 0, length: t.split(" ")[0].length }] : undefined;
  return { update_id: updateId++, message: { message_id: ++seq, date: 0, chat: chat(u), from: from(u), text: t, entities: cmd } };
}
function cb(data: string, u = SUPER): Update {
  return {
    update_id: updateId++,
    callback_query: { id: String(updateId), from: from(u), chat_instance: "ci", data, message: { message_id: 1, date: 0, chat: chat(u), text: "x" } },
  };
}
function usersShared(userId: number, u = SUPER): Update {
  return { update_id: updateId++, message: { message_id: ++seq, date: 0, chat: chat(u), from: from(u), users_shared: { request_id: 7101, users: [{ user_id: userId }] } } };
}

const texts = () => calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").map((c) => String(c.payload.text ?? ""));
const alerts = () => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => String(c.payload.text ?? ""));
const buttons = () =>
  calls.flatMap((c) => {
    const kb = c.payload.reply_markup as { inline_keyboard?: { callback_data?: string }[][]; keyboard?: { text: string; request_users?: unknown }[][] } | undefined;
    return [...(kb?.inline_keyboard ?? []).flat().map((b) => b.callback_data ?? ""), ...(kb?.keyboard ?? []).flat().map((b) => (b.request_users ? "request_users" : b.text))];
  });

describe.skipIf(!enabled)("botda adminlarni boshqarish (ID orqali)", () => {
  let bot: Bot<BotContext>;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE bot_state, audit_log, events, messages, admins, settings, users RESTART IDENTITY CASCADE`);
    invalidateSettings();
    await prisma.admin.createMany({
      data: [
        { telegramId: BigInt(SUPER.id), role: "superadmin", name: "Boss" },
        { telegramId: BigInt(HELPER.id), role: "admin", name: "Yordamchi" },
      ],
    });
    await prisma.user.create({ data: { telegramId: 8100n, firstName: "Nodir", username: "nodir_dev" } });
    bot = makeBot();
    await bot.init();
  });
  beforeEach(() => {
    calls.length = 0;
  });
  afterAll(() => prisma.$disconnect());

  it("ro'yxat: super admin ko'radi, oddiy admin kira olmaydi", async () => {
    await bot.handleUpdate(cb("ap:admins"));
    expect(texts().join("\n")).toContain("Adminlar");
    expect(buttons()).toEqual(expect.arrayContaining([`adm:ad:v:${SUPER.id}`, `adm:ad:v:${HELPER.id}`, "adm:ad:add"]));

    calls.length = 0;
    await bot.handleUpdate(cb("ap:admins", HELPER));
    await bot.handleUpdate(cb("adm:ad:add", HELPER));
    expect(texts().join("\n")).not.toContain("Yangi admin");
  });

  it("ID yozib qo'shish: noto'g'ri ID rad etiladi, to'g'risi — rol tanlash, keyin admin va unga xabar", async () => {
    await bot.handleUpdate(cb("adm:ad:add"));
    expect(buttons()).toContain("request_users");
    await bot.handleUpdate(text("salom"));
    expect(texts().at(-1)).toContain("faqat raqamlardan");

    await bot.handleUpdate(text("8100"));
    expect(texts().at(-1)).toContain("faqat raqamlardan"); // 5 ta raqamdan kam

    calls.length = 0;
    await bot.handleUpdate(text("81000000"));
    expect(buttons()).toEqual(expect.arrayContaining(["adm:ad:n:81000000:a", "adm:ad:n:81000000:s"]));
    // Kutish holati tugadi — keyingi matn oddiy xabar
    expect(await prisma.botState.count()).toBe(0);

    calls.length = 0;
    await bot.handleUpdate(cb("adm:ad:n:81000000:a"));
    expect(await prisma.admin.findUniqueOrThrow({ where: { telegramId: 81000000n } })).toMatchObject({ role: "admin", isActive: true });
    expect(calls.some((c) => c.method === "sendMessage" && Number(c.payload.chat_id) === 81000000)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "add_admin" } })).toBe(1);
  });

  it("«Foydalanuvchini tanlash» (users_shared) orqali — ism bot foydalanuvchisidan olinadi", async () => {
    await bot.handleUpdate(cb("adm:ad:add"));
    calls.length = 0;
    await bot.handleUpdate(usersShared(8100));
    expect(texts().join("\n")).toContain("Nodir");
    await bot.handleUpdate(cb("adm:ad:n:8100:s"));
    expect(await prisma.admin.findUniqueOrThrow({ where: { telegramId: 8100n } })).toMatchObject({ role: "superadmin", name: "Nodir" });
  });

  it("rolni almashtirish va adminlikdan olish (tasdiq bilan)", async () => {
    await bot.handleUpdate(cb(`adm:ad:r:${HELPER.id}:s`));
    expect((await prisma.admin.findUniqueOrThrow({ where: { telegramId: BigInt(HELPER.id) } })).role).toBe("superadmin");
    await bot.handleUpdate(cb(`adm:ad:r:${HELPER.id}:a`));
    expect((await prisma.admin.findUniqueOrThrow({ where: { telegramId: BigInt(HELPER.id) } })).role).toBe("admin");

    calls.length = 0;
    await bot.handleUpdate(cb(`adm:ad:d:${HELPER.id}`));
    expect(buttons()).toContain(`adm:ad:dok:${HELPER.id}`);
    expect((await prisma.admin.findUniqueOrThrow({ where: { telegramId: BigInt(HELPER.id) } })).isActive).toBe(true);
    await bot.handleUpdate(cb(`adm:ad:dok:${HELPER.id}`));
    expect((await prisma.admin.findUniqueOrThrow({ where: { telegramId: BigInt(HELPER.id) } })).isActive).toBe(false);

    // Olingan admin endi admin buyruqlaridan foydalana olmaydi
    calls.length = 0;
    await bot.handleUpdate(cb("ap:admins", HELPER));
    expect(texts().join("\n")).not.toContain("Adminlar");
  });

  it("himoya: o'zini o'zgartira olmaydi; oxirgi super admin qoladi", async () => {
    calls.length = 0;
    await bot.handleUpdate(cb(`adm:ad:r:${SUPER.id}:a`));
    expect(alerts().join()).toContain("O'zingizning");
    expect((await prisma.admin.findUniqueOrThrow({ where: { telegramId: BigInt(SUPER.id) } })).role).toBe("superadmin");

    // 8100 ni ham oddiy admin qilamiz — faqat SUPER super admin qoladi
    await bot.handleUpdate(cb("adm:ad:r:8100:a"));
    await expect(revokeAdmin(999n, BigInt(SUPER.id))).rejects.toBeInstanceOf(AdminChangeError);
    await expect(setAdminRole(999n, BigInt(SUPER.id), "admin")).rejects.toThrow("Kamida bitta super admin");
  });

  it("eski buyruqlar ishlaydi: /admins, /addadmin", async () => {
    await bot.handleUpdate(text("/addadmin 82000000"));
    expect(texts().at(-1)).toContain("Admin qo'shildi");
    calls.length = 0;
    await bot.handleUpdate(text("/admins"));
    expect(texts().join("\n")).toContain("82000000");
  });
});
