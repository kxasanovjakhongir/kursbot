import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { GrammyError, type Api, type Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { prisma } from "../src/db";
import { createBot } from "../src/bot/bot";
import type { BotContext } from "../src/bot/context";
import { CAPTION_LIMIT, fitCaption } from "../src/bot/admin/receiptCard";
import { fitBlocks } from "../src/bot/admin/summaries";
import { approveAndNotify } from "../src/bot/admin/reviewActions";
import { createApp } from "../src/api/app";
import { signInitData } from "../src/lib/telegramAuth";
import { stripHtml } from "../src/lib/format";
import { parseLogLine } from "../src/lib/errorSink";
import { processExpiredGrants } from "../src/services/membership";
import { courseStats } from "../src/services/analytics";
import { addCard } from "../src/services/cards";
import { invalidateSettings, setSetting } from "../src/services/settings";
import { invalidateTexts } from "../src/i18n";

const enabled = !!process.env.TEST_DATABASE_URL;

const tgError = (method: string, code: number, description: string) =>
  new GrammyError("Call failed", { ok: false, error_code: code, description }, method, {});

// ---------- Birlik testlari (bazasiz) ----------

describe("xabar uzunligi chegaralari", () => {
  it("chek kartochkasi: 1024 belgidan oshmaydi, sarlavha va holat qatori saqlanadi", () => {
    const lines = [
      "🟡 Qayta urinish",
      "",
      "<b>Yangi chek — buyurtma #7</b>",
      `Mahsulot: ${"K".repeat(100)}`,
      "Summa: <b>1 000 so'm</b>",
      `Mijoz: ${"M".repeat(300)}`,
      `Manba: ${"s".repeat(300)}`,
      `Buyurtma ochilgan: ${"d".repeat(200)}`,
      "Urinish: 2 / 3",
      "",
      `❌ <b>Rad etildi</b>: ${"r".repeat(200)}`,
    ];
    const out = fitCaption(lines);
    expect(stripHtml(out).length).toBeLessThanOrEqual(CAPTION_LIMIT);
    expect(out).toContain("Yangi chek — buyurtma #7");
    expect(out).toContain("Rad etildi");
    expect(out).not.toContain("Manba:");
    // Qisqa matn o'zgarmaydi
    expect(fitCaption(["a", "b"])).toBe("a\nb");
  });

  it("chek kartochkasi: ikkinchi darajali qatorlarsiz ham oshsa — oddiy matn sifatida kesiladi", () => {
    const out = fitCaption([`<b>${"x".repeat(2000)}</b>`]);
    expect(out.length).toBeLessThanOrEqual(CAPTION_LIMIT);
    expect(out).not.toContain("<b>");
  });

  it("admin ro'yxatlari: 4096 dan oshmaydi, qolgani 'yana N ta' deb ko'rsatiladi", () => {
    const blocks = Array.from({ length: 40 }, (_, i) => `<b>Kurs ${i}</b>\n${"x".repeat(200)}`);
    const out = fitBlocks(blocks, "\n\n", "mahsulot");
    expect(out.length).toBeLessThanOrEqual(4096);
    expect(out).toMatch(/yana \d+ ta mahsulot/);
    expect(fitBlocks(["a", "b"], "\n", "admin")).toBe("a\nb");
  });

  it("xato logi: faqat error/fatal, token niqobi saqlanadi", () => {
    expect(parseLogLine(JSON.stringify({ level: 40, msg: "ogohlantirish" }))).toBeNull();
    expect(parseLogLine("json emas")).toBeNull();
    const e = parseLogLine(JSON.stringify({ level: 60, msg: "ishga tushmadi", err: { type: "Error", message: "port 8080 band" }, port: 8080 }));
    expect(e).toMatchObject({ level: "fatal", message: "ishga tushmadi", errorText: "port 8080 band", context: { port: 8080 } });
    const other = parseLogLine(JSON.stringify({ level: 50, msg: "ishga tushmadi", err: { type: "Error", message: "port 3000 band" } }));
    expect(other!.fingerprint).toBe(e!.fingerprint);
  });
});

// ---------- Bot (integratsion) ----------

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
let seq = 5000;
let updateId = 1;
/** Telegram metodi uchun soxta xato (bir marta) */
const failures = new Map<string, GrammyError>();

function makeBot(): Bot<BotContext> {
  const bot = createBot("123:test-token", { botInfo: BOT_INFO });
  bot.api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    const fail = failures.get(method);
    if (fail) {
      failures.delete(method);
      throw fail;
    }
    const message = { message_id: ++seq, date: Math.floor(Date.now() / 1000), chat: { id: Number(p.chat_id), type: "private" } };
    const result = method === "getMe" ? BOT_INFO : method.startsWith("send") || method === "editMessageText" ? message : true;
    return { ok: true, result } as unknown as Awaited<ReturnType<typeof _prev>>;
  });
  return bot;
}

const USER = { id: 6001, is_bot: false as const, first_name: "Aziz", language_code: "uz" };
const SUPER = { id: 9101, is_bot: false as const, first_name: "Boss" };
const chatOf = (u: typeof USER | typeof SUPER) => ({ id: u.id, type: "private" as const, first_name: u.first_name });
const now = () => Math.floor(Date.now() / 1000);

function text(t: string, from: typeof USER | typeof SUPER = USER): Update {
  const cmd = t.startsWith("/") ? [{ type: "bot_command" as const, offset: 0, length: t.split(" ")[0].length }] : undefined;
  return { update_id: updateId++, message: { message_id: ++seq, date: now(), chat: chatOf(from), from, text: t, entities: cmd } };
}
function callback(data: string, from: typeof USER = USER): Update {
  return {
    update_id: updateId++,
    callback_query: { id: String(updateId), from, chat_instance: "ci", data, message: { message_id: 77, date: now(), chat: chatOf(from), from: BOT_INFO, text: "ekran" } },
  };
}
function joinRequest(channelId: number, link: string, from = USER): Update {
  return {
    update_id: updateId++,
    chat_join_request: {
      chat: { id: channelId, type: "channel", title: "Kanal" },
      from,
      user_chat_id: from.id,
      date: now(),
      invite_link: { invite_link: link, creator: BOT_INFO, creates_join_request: true, is_primary: false, is_revoked: false },
    },
  } as Update;
}

const ADMIN_GROUP = -100500;

async function reset() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE notifications, events, audit_log, messages, access_grants, receipts, orders, cards, campaign_links, products, admins, settings, texts, error_logs, users RESTART IDENTITY CASCADE`,
  );
  invalidateSettings();
  invalidateTexts();
  await setSetting("admin_group_id", String(ADMIN_GROUP));
  await prisma.admin.create({ data: { telegramId: BigInt(SUPER.id), role: "superadmin", name: "Boss" } });
  await prisma.user.create({ data: { telegramId: BigInt(USER.id), firstName: "Aziz", phone: "+998901234567", registeredAt: new Date() } });
  calls = [];
  failures.clear();
}

describe.skipIf(!enabled)("barqarorlik tuzatishlari (bot)", () => {
  let bot: Bot<BotContext>;
  beforeEach(async () => {
    await reset();
    bot = makeBot();
  });
  afterAll(() => prisma.$disconnect());
  const send = async (...updates: Update[]) => {
    for (const u of updates) await bot.handleUpdate(u);
  };
  const replies = () => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text ?? ""));

  it("uzun tavsifli kurs + video: video izohsiz, matn alohida (Telegram 1024 cheklovi)", async () => {
    await prisma.product.create({ data: { code: "uzun", title: "U".repeat(100), price: 1000, oldPrice: 2000, isActive: true, videoFileId: "vid", description: "t".repeat(900) } });
    await prisma.product.create({ data: { code: "qisqa", title: "Qisqa kurs", price: 1000, isActive: true, videoFileId: "vid2", description: "qisqa" } });

    await send(callback("p:uzun"));
    const video = calls.find((c) => c.method === "sendVideo")!;
    expect(video.payload.caption).toBeUndefined();
    const screen = calls.filter((c) => c.method === "sendMessage").at(-1)!;
    expect(String(screen.payload.text)).toContain("t".repeat(100));
    expect(calls.some((c) => c.method === "sendMessage" && String(c.payload.text).includes("xato"))).toBe(false);

    calls = [];
    await send(callback("p:qisqa"));
    const short = calls.find((c) => c.method === "sendVideo")!;
    expect(String(short.payload.caption)).toContain("Qisqa kurs");
  });

  it("to'plamning yetishmayotgan qismi sotuvdan olingan — ko'rsatilmaydi, katalogga qaytadi", async () => {
    const [a, b] = await Promise.all([
      prisma.product.create({ data: { code: "a1", title: "A", price: 100, channelId: -1001n, isActive: true } }),
      prisma.product.create({ data: { code: "b1", title: "B", price: 100, channelId: -1002n, isActive: false } }),
    ]);
    await prisma.product.create({ data: { code: "ab", title: "A+B", price: 150, type: "bundle", bundleCodes: ["a1", "b1"], isActive: true } });
    const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(USER.id) } });
    const order = await prisma.order.create({ data: { userId: user.id, productId: a.id, amount: 100, status: "joined", expiresAt: new Date() } });
    await prisma.accessGrant.create({ data: { userId: user.id, productId: a.id, orderId: order.id } });

    await send(callback("p:ab"));
    expect(calls.some((c) => c.method === "sendMessage" && String(c.payload.text).includes("<b>B</b>"))).toBe(false);
    expect(b.isActive).toBe(false);
    expect(replies().some((t) => t.includes("topilmadi") || t.includes("Topilmadi"))).toBe(true);
  });

  it("admin buyruqlari: band kod, juda katta narx, uzun nom — tushunarli javob (xato emas)", async () => {
    await prisma.product.create({ data: { code: "4b", title: "Bor", price: 100 } });
    await prisma.campaignLink.create({ data: { code: "promo", productId: (await prisma.product.findFirstOrThrow()).id, source: "ig" } });
    await send(text("/addproduct 4b Yana", SUPER), text("/addproduct promo Kurs", SUPER), text("/setprice 4b 99999999999", SUPER), text(`/settitle 4b ${"n".repeat(150)}`, SUPER));
    const r = replies();
    expect(r[0]).toContain("band");
    expect(r[1]).toContain("kampaniya linki");
    expect(r[2]).toContain("oshmasin");
    expect(r[3]).toContain("oshmasin");
    expect((await prisma.product.findUniqueOrThrow({ where: { code: "4b" } })).price).toBe(100);
    expect(await prisma.errorLog.count()).toBe(0);
  });

  it("/products: 40 ta kurs bo'lsa ham xabar 4096 belgidan oshmaydi", async () => {
    await prisma.product.createMany({
      data: Array.from({ length: 40 }, (_, i) => ({ code: `k${i}`, title: `Kurs raqami ${i} — ${"uzun nom ".repeat(6)}`, price: 1_000_000, channelId: -1000000000n - BigInt(i) })),
    });
    await send(text("/products", SUPER));
    const msg = calls.find((c) => c.method === "sendMessage")!;
    expect(String(msg.payload.text).length).toBeLessThanOrEqual(4096);
    expect(String(msg.payload.text)).toMatch(/yana \d+ ta mahsulot/);
  });

  describe("kanalga qo'shilish so'rovi", () => {
    async function setup() {
      const product = await prisma.product.create({ data: { code: "kan", title: "Kanal kursi", price: 100, channelId: -1007777n } });
      const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(USER.id) } });
      const order = await prisma.order.create({ data: { userId: user.id, productId: product.id, amount: 100, status: "approved", expiresAt: new Date() } });
      await prisma.accessGrant.create({ data: { userId: user.id, productId: product.id, orderId: order.id, inviteLink: "https://t.me/+own" } });
    }

    it("allaqachon a'zo (USER_ALREADY_PARTICIPANT) — zararsiz: mijoz xush kelibsiz xabarini oladi", async () => {
      await setup();
      failures.set("approveChatJoinRequest", tgError("approveChatJoinRequest", 400, "Bad Request: USER_ALREADY_PARTICIPANT"));
      await send(joinRequest(-1007777, "https://t.me/+own"));
      expect(calls.some((c) => c.method === "sendMessage" && Number(c.payload.chat_id) === USER.id)).toBe(true);
      expect(calls.some((c) => c.method === "sendMessage" && Number(c.payload.chat_id) === ADMIN_GROUP)).toBe(false);
    });

    it("bot huquqi yo'q — adminlarga ogohlantirish, mijozga texnik xato ko'rsatilmaydi", async () => {
      await setup();
      failures.set("approveChatJoinRequest", tgError("approveChatJoinRequest", 400, "Bad Request: CHAT_ADMIN_REQUIRED"));
      await send(joinRequest(-1007777, "https://t.me/+own"));
      const toAdmins = calls.filter((c) => c.method === "sendMessage" && Number(c.payload.chat_id) === ADMIN_GROUP);
      expect(toAdmins.some((c) => String(c.payload.text).includes("tasdiqlanmadi"))).toBe(true);
      expect(calls.some((c) => c.method === "sendMessage" && Number(c.payload.chat_id) === USER.id)).toBe(false);
    });
  });

  it("chek tasdiqlandi, lekin mijoz chati topilmadi — tasdiqlash muvaffaqiyatli, adminlar ogohlantiriladi", async () => {
    const product = await prisma.product.create({ data: { code: "tt", title: "T", price: 100, channelId: -1001n } });
    const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(USER.id) } });
    const order = await prisma.order.create({ data: { userId: user.id, productId: product.id, amount: 100, status: "receipt_sent", expiresAt: new Date(Date.now() + 3600_000) } });
    const toAdmins: string[] = [];
    const api = {
      createChatInviteLink: async () => ({ invite_link: "https://t.me/+ok" }),
      editMessageCaption: async () => true,
      editMessageText: async () => true,
      sendMessage: async (chatId: number, text: string) => {
        if (chatId === USER.id) throw tgError("sendMessage", 400, "Bad Request: chat not found");
        toAdmins.push(text);
        return { message_id: 1, chat: { id: chatId } };
      },
    } as unknown as Api;
    expect(await approveAndNotify(api, order.id, { adminId: null })).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("approved");
    expect(toAdmins.some((t) => t.includes("yetkazilmadi"))).toBe(true);
  });
});

// ---------- Fon vazifasi: muddati o'tgan kirishlar ----------

describe.skipIf(!enabled)("muddati o'tgan kirishlar: bitta 'buzuq' kanal boshqalarini to'smaydi", () => {
  afterAll(() => prisma.$disconnect());

  it("huquqi yo'q kanaldagi 150 ta yozuvdan keyingi boshqa kanal kirishi ham chiqariladi", async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE notifications, access_grants, orders, products, users RESTART IDENTITY CASCADE`);
    const BAD = -1008888n;
    const GOOD = -1009999n;
    const [bad, good] = await Promise.all([
      prisma.product.create({ data: { code: "bad", title: "Buzuq", price: 1, channelId: BAD } }),
      prisma.product.create({ data: { code: "good", title: "Yaxshi", price: 1, channelId: GOOD } }),
    ]);
    const past = new Date(Date.now() - 86400_000);
    // Buzuq kanal yozuvlari birinchi (eski navbatda BATCH=100 ning hammasini egallardi)
    for (let i = 0; i < 150; i++) {
      const u = await prisma.user.create({ data: { telegramId: BigInt(70000 + i), firstName: `U${i}` } });
      const o = await prisma.order.create({ data: { userId: u.id, productId: bad.id, amount: 1, status: "joined", expiresAt: past } });
      await prisma.accessGrant.create({ data: { userId: u.id, productId: bad.id, orderId: o.id, expiresAt: past } });
    }
    const last = await prisma.user.create({ data: { telegramId: 79999n, firstName: "Oxirgi" } });
    const lo = await prisma.order.create({ data: { userId: last.id, productId: good.id, amount: 1, status: "joined", expiresAt: past } });
    const goodGrant = await prisma.accessGrant.create({ data: { userId: last.id, productId: good.id, orderId: lo.id, expiresAt: past } });

    const api = {
      banChatMember: async (chatId: number) => {
        if (BigInt(chatId) === BAD) throw tgError("banChatMember", 400, "Bad Request: not enough rights to restrict/unrestrict chat member");
        return true;
      },
      unbanChatMember: async () => true,
      revokeChatInviteLink: async () => true,
      sendMessage: async (chatId: number) => ({ message_id: 1, chat: { id: chatId } }),
    } as unknown as Api;

    const res = await processExpiredGrants(api);
    expect(res).toEqual({ removed: 1, pending: 150 });
    expect((await prisma.accessGrant.findUniqueOrThrow({ where: { id: goodGrant.id } })).revokedAt).not.toBeNull();
  });
});

// ---------- Mini App: chek rasmi zaxira yo'li va uzun video izohi ----------

describe.skipIf(!enabled)("Mini App: Telegram cheklovlari", () => {
  const TOKEN = "777:hardening-token";
  const PNG = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex");
  const methods: { method: string; caption?: string }[] = [];
  let photoFails = false;
  const api = {
    token: TOKEN,
    getMe: async () => ({ id: 42, is_bot: true, first_name: "Test", username: "test_bot" }),
    sendMessage: async (chatId: number) => {
      methods.push({ method: "sendMessage" });
      return { message_id: 1, chat: { id: chatId } };
    },
    sendPhoto: async (chatId: number) => {
      methods.push({ method: "sendPhoto" });
      if (photoFails) throw tgError("sendPhoto", 400, "Bad Request: PHOTO_INVALID_DIMENSIONS");
      return { message_id: 2, chat: { id: chatId }, photo: [{ file_id: "ph", file_unique_id: "uph", width: 1, height: 1 }] };
    },
    sendDocument: async (chatId: number) => {
      methods.push({ method: "sendDocument" });
      return { message_id: 3, chat: { id: chatId }, document: { file_id: "doc", file_unique_id: "udoc" } };
    },
    sendVideo: async (_chatId: number, _video: string, opts?: { caption?: string }) => {
      methods.push({ method: "sendVideo", caption: opts?.caption });
      return { message_id: 4 };
    },
    editMessageCaption: async () => true,
    editMessageText: async () => true,
  } as unknown as Api;
  afterAll(() => prisma.$disconnect());

  async function login(app: ReturnType<typeof createApp>) {
    const initData = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 8801, first_name: "Aziz" }) }, TOKEN);
    const res = await request(app).post("/api/app/auth/telegram").send({ initData });
    return { Authorization: `Bearer ${res.body.token}` };
  }

  it("Telegram rasmni qabul qilmasa — chek hujjat sifatida saqlanadi (yo'qolmaydi)", async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE notifications, events, receipts, access_grants, orders, cards, products, settings, users RESTART IDENTITY CASCADE`);
    invalidateSettings();
    await addCard("8600123412341234", "A. Karimov");
    const product = await prisma.product.create({ data: { code: "rc", title: "Kurs", price: 1000, isActive: true, channelId: -1001n } });
    const app = createApp({ runtime: { api, mode: "polling", tokenSource: "env", isRunning: () => true } });
    const h = await login(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: 8801n } });
    const order = await prisma.order.create({ data: { userId: user.id, productId: product.id, amount: 1000, expiresAt: new Date(Date.now() + 3600_000) } });

    photoFails = true;
    methods.length = 0;
    const res = await request(app).post(`/api/app/orders/${order.id}/receipt`).set(h).attach("file", PNG, { filename: "uzun-chek.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(methods.map((m) => m.method).slice(0, 2)).toEqual(["sendPhoto", "sendDocument"]);
    const receipt = await prisma.receipt.findFirstOrThrow({ where: { orderId: order.id } });
    expect(receipt).toMatchObject({ fileType: "image", fileId: "doc" });
    photoFails = false;
  });

  it("uzun tavsifli kurs videosi Mini App'dan: video izohsiz, matn alohida xabar", async () => {
    await prisma.product.create({ data: { code: "vv", title: "V".repeat(100), price: 1000, isActive: true, videoFileId: "vid", description: "d".repeat(930) } });
    const app = createApp({ runtime: { api, mode: "polling", tokenSource: "env", isRunning: () => true } });
    const h = await login(app);
    methods.length = 0;
    const res = await request(app).post("/api/app/products/vv/video").set(h);
    expect(res.status).toBe(200);
    expect(methods[0]).toEqual({ method: "sendVideo", caption: undefined });
    expect(methods[1].method).toBe("sendMessage");
  });
});

// ---------- Analitika: o'chirilgan kurs ----------

describe.skipIf(!enabled)("analitika: o'chirilgan kurs tarixi yo'qolmaydi", () => {
  afterAll(() => prisma.$disconnect());

  it("kodi o'zgargan (yumshoq o'chirilgan) kursning ko'rishlari va tushumi hisoblanadi", async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE events, access_grants, orders, campaign_links, products, users RESTART IDENTITY CASCADE`);
    const user = await prisma.user.create({ data: { telegramId: 9901n, firstName: "X" } });
    const p = await prisma.product.create({ data: { code: "eski", title: "Eski kurs", price: 500 } });
    await prisma.event.create({ data: { userId: user.id, name: "product_view", payload: { product: "eski" } } });
    await prisma.order.create({ data: { userId: user.id, productId: p.id, amount: 500, status: "approved", paidAt: new Date(), expiresAt: new Date() } });
    await prisma.product.update({ where: { id: p.id }, data: { code: `eski~${p.id}`, deletedAt: new Date(), isActive: false } });
    // Faolligi yo'q o'chirilgan kurs ro'yxatda ko'rinmaydi
    await prisma.product.create({ data: { code: "bosh~99", title: "Bo'sh", price: 1, deletedAt: new Date() } });

    const rows = await courseStats({ from: new Date(Date.now() - 86400_000), to: new Date(Date.now() + 60_000) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "eski", title: "Eski kurs (o'chirilgan)", viewed: 1, purchases: 1, revenue: 500 });
  });
});
