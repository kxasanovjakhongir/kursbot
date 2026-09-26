import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import type { Express } from "express";
import { prisma } from "../src/db";
import { createApp } from "../src/api/app";
import { createBot } from "../src/bot/bot";
import type { BotContext } from "../src/bot/context";
import { signInitData } from "../src/lib/telegramAuth";
import { resolveEntry } from "../src/services/campaignLinks";
import { createPanelUser } from "../src/services/panelUsers";
import { addCard } from "../src/services/cards";
import { invalidateSettings } from "../src/services/settings";
import { invalidateTexts } from "../src/i18n";
import { setPhone } from "../src/services/users";

const enabled = !!process.env.TEST_DATABASE_URL;
const TOKEN = "123:test-token";

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

// ---------- Soxta Telegram (bot va API uchun umumiy) ----------

interface Call {
  method: string;
  payload: Record<string, unknown>;
}
const calls: Call[] = [];
let seq = 0;

function makeBot(): Bot<BotContext> {
  const bot = createBot(TOKEN, { botInfo: BOT_INFO });
  bot.api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    const result = method.startsWith("send") || method === "editMessageText"
      ? { message_id: ++seq, date: 0, chat: { id: Number(p.chat_id), type: "private" }, text: p.text }
      : method === "getMe" ? BOT_INFO : true;
    return { ok: true, result } as unknown as Awaited<ReturnType<typeof _prev>>;
  });
  return bot;
}

const texts = () => calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").map((c) => String(c.payload.text ?? ""));
const webAppUrls = () =>
  calls.flatMap((c) => {
    const kb = c.payload.reply_markup as { inline_keyboard?: { web_app?: { url: string } }[][] } | undefined;
    return (kb?.inline_keyboard ?? []).flat().flatMap((b) => (b.web_app ? [b.web_app.url] : []));
  });

let updateId = 1;
function start(payload: string, from: { id: number; first_name: string }): Update {
  const t = payload ? `/start ${payload}` : "/start";
  return {
    update_id: updateId++,
    message: {
      message_id: ++seq,
      date: Math.floor(Date.now() / 1000),
      chat: { id: from.id, type: "private", first_name: from.first_name },
      from: { ...from, is_bot: false, language_code: "uz" },
      text: t,
      entities: [{ type: "bot_command", offset: 0, length: 6 }],
    },
  };
}

const initData = (id: number, startParam?: string) =>
  signInitData(
    { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "Ali" }), ...(startParam ? { start_param: startParam } : {}) },
    TOKEN,
  );

describe.skipIf(!enabled)("kampaniya linklari (deep link): bot, Mini App, panel, statistika", () => {
  let bot: Bot<BotContext>;
  let app: Express;
  let admin: { Authorization: string };
  let frontend: { id: number; code: string };
  let link: { id: number; code: string };

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE link_visits, campaign_links, notifications, activity_logs, panel_users, events, messages, receipts, access_grants, orders, cards, products, admins, settings, texts, users RESTART IDENTITY CASCADE`,
    );
    invalidateSettings();
    invalidateTexts();
    await prisma.product.createMany({
      data: [
        { code: "fe", title: "Frontend Development", price: 900_000, channelId: -1001n, sortOrder: 1 },
        { code: "be", title: "Backend", price: 800_000, channelId: -1002n, sortOrder: 2 },
        { code: "old", title: "Eski kurs", price: 500_000, channelId: -1003n, sortOrder: 3, isActive: false },
      ],
    });
    frontend = await prisma.product.findUniqueOrThrow({ where: { code: "fe" } });
    await addCard("8600123412341234", "A. Karimov");
    await createPanelUser({ email: "admin@test.uz", name: "Admin", password: "adminpass1", role: "admin" });

    bot = makeBot();
    await bot.init();
    app = createApp({ runtime: { api: bot.api, mode: "polling", tokenSource: "env", isRunning: () => true } });
    admin = { Authorization: `Bearer ${(await request(app).post("/api/auth/login").send({ email: "admin@test.uz", password: "adminpass1" })).body.token}` };
  });
  beforeEach(() => {
    calls.length = 0;
  });
  afterAll(() => prisma.$disconnect());

  it("panel: ADMIN link yaratadi (avtomatik qisqa kod), o'z kodi tekshiriladi, mahsulot kodi bilan to'qnashmaydi", async () => {
    expect((await request(app).post("/api/links").send({ productId: frontend.id, source: "instagram" })).status).toBe(401);

    const res = await request(app).post("/api/links").set(admin).send({ productId: frontend.id, source: "Instagram", campaign: "Sentabr 2026", medium: "Story" });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^c[a-z2-9]{6}$/);
    expect(res.body).toMatchObject({ source: "instagram", medium: "story", campaign: "Sentabr 2026", isActive: true });
    expect(res.body.urls.bot).toBe(`https://t.me/test_bot?start=${res.body.code}`);
    link = res.body;

    const bad = (code: string) => request(app).post("/api/links").set(admin).send({ productId: frontend.id, source: "tiktok", code });
    expect((await bad("a_b")).status).toBe(400); // "_" — eski format ajratgichi
    expect((await bad("x")).status).toBe(400);
    expect((await bad("be")).status).toBe(400); // mahsulot kodi
    expect((await bad(link.code)).status).toBe(400); // band
    expect((await bad("frontend-sep")).status).toBe(201);
    expect((await request(app).post("/api/links").set(admin).send({ productId: 999, source: "x" })).status).toBe(400);
  });

  it("CASE 1: linksiz /start — umumiy salomlashuv, fallback xabari yo'q", async () => {
    await bot.handleUpdate(start("", { id: 7001, first_name: "Oddiy" }));
    expect(texts().join("\n")).not.toContain("eskirgan");
    expect(await prisma.linkVisit.count()).toBe(0);
  });

  it("CASE 2 + 7: link orqali /start — aynan shu darslik, manba saqlanadi, kirish yoziladi", async () => {
    const user = await prisma.user.create({ data: { telegramId: 7002n, firstName: "Vali", phone: "+998901112233" } });
    await bot.handleUpdate(start(link.code, { id: 7002, first_name: "Vali" }));

    const all = texts().join("\n");
    expect(all).toContain("Frontend Development");
    expect(all).not.toContain("Backend");
    // Mini App tugmasi aynan shu darslik sahifasini ochadi (bot → ilova kontekst)
    expect(webAppUrls()).toContain("https://app.example.uz/app/product/fe");

    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(u).toMatchObject({ lastLinkId: link.id, lastSource: "instagram", firstSource: "instagram", lastProduct: "fe" });
    expect(await prisma.linkVisit.count({ where: { linkId: link.id, via: "bot" } })).toBe(1);

    // Takroriy bosish (30 daqiqa ichida) — kirishlar soni oshmaydi
    await bot.handleUpdate(start(link.code, { id: 7002, first_name: "Vali" }));
    expect(await prisma.linkVisit.count({ where: { linkId: link.id } })).toBe(1);
  });

  it("CASE 4: noto'g'ri kod — «havola noto'g'ri yoki eskirgan» va umumiy oqim", async () => {
    await prisma.user.create({ data: { telegramId: 7003n, firstName: "G", phone: "+998901112244" } });
    await bot.handleUpdate(start("invalid", { id: 7003, first_name: "G" }));
    expect(texts().join("\n")).toContain("noto'g'ri yoki eskirgan");
    for (const p of ["c999999", "a".repeat(70), "x<script>", "../etc"]) {
      expect((await resolveEntry(p)).kind).toBe("unavailable");
    }
  });

  it("eski format (4b_instagram) avvalgidek ishlaydi", async () => {
    const entry = await resolveEntry("be_tiktok");
    expect(entry).toMatchObject({ kind: "product", source: "tiktok", link: null });
    expect(entry.kind === "product" && entry.product.code).toBe("be");
  });

  it("CASE 5 + 6: o'chirilgan link va nofaol mahsulot — fallback", async () => {
    const disabled = await request(app).post("/api/links").set(admin).send({ productId: frontend.id, source: "facebook" });
    expect((await request(app).patch(`/api/links/${disabled.body.id}`).set(admin).send({ isActive: false })).status).toBe(200);
    expect((await resolveEntry(disabled.body.code)).kind).toBe("unavailable");

    await prisma.user.create({ data: { telegramId: 7004n, firstName: "D", phone: "+998901112255" } });
    await bot.handleUpdate(start(disabled.body.code, { id: 7004, first_name: "D" }));
    expect(texts().join("\n")).toContain("noto'g'ri yoki eskirgan");
    expect(await prisma.linkVisit.count({ where: { linkId: disabled.body.id } })).toBe(0);

    const old = await prisma.product.findUniqueOrThrow({ where: { code: "old" } });
    const oldLink = await request(app).post("/api/links").set(admin).send({ productId: old.id, source: "instagram" });
    expect((await resolveEntry(oldLink.body.code)).kind).toBe("unavailable");

    // Qayta yoqilsa — yana ishlaydi
    await request(app).patch(`/api/links/${disabled.body.id}`).set(admin).send({ isActive: true });
    expect((await resolveEntry(disabled.body.code)).kind).toBe("product");
  });

  it("CASE 3: Mini App startapp=<kod> — darslik aniqlanadi (imzolangan initData), kirish yoziladi", async () => {
    const res = await request(app).post("/api/app/auth/telegram").send({ initData: initData(7010, link.code) });
    expect(res.status).toBe(200);
    expect(res.body.entry).toEqual({ status: "ok", productCode: "fe" });
    expect(res.body.me.featured).toEqual({ code: "fe", title: "Frontend Development" });
    expect(await prisma.linkVisit.count({ where: { linkId: link.id, via: "webapp", isNewUser: true } })).toBe(1);

    expect((await request(app).post("/api/app/auth/telegram").send({ initData: initData(7011) })).body.entry).toBeNull();
    expect((await request(app).post("/api/app/auth/telegram").send({ initData: initData(7012, "yoq-kod") })).body.entry).toEqual({ status: "unavailable" });
  });

  it("CASE 8 + 9: bot linki → Mini App'da buyurtma — kontekst saqlanadi, buyurtma linkka bog'lanadi, statistika", async () => {
    // Vali (7002) bot orqali link bilan kirgan; endi Mini App'ni menyu tugmasi bilan (start_param siz) ochadi
    const login = await request(app).post("/api/app/auth/telegram").send({ initData: initData(7002) });
    expect(login.body.me.featured).toEqual({ code: "fe", title: "Frontend Development" });
    const order = await request(app).post("/api/app/orders").set("Authorization", `Bearer ${login.body.token}`).send({ productCode: "fe" });
    expect(order.status).toBe(201);
    const saved = await prisma.order.findFirstOrThrow({ where: { user: { telegramId: 7002n } } });
    expect(saved.linkId).toBe(link.id);

    await prisma.order.update({ where: { id: saved.id }, data: { status: "approved", paidAt: new Date() } });
    const list = await request(app).get("/api/links").set(admin);
    const row = list.body.items.find((l: { id: number }) => l.id === link.id);
    expect(row.stats).toMatchObject({ visits: 2, users: 2, newUsers: 1, orders: 1, paid: 1, revenue: 900_000, conversion: 50 });

    // Link orqali kelmagan foydalanuvchining buyurtmasi linkka yozilmaydi
    await prisma.user.update({ where: { telegramId: 7011n }, data: { phone: "+998901110000" } });
    const plain = await request(app).post("/api/app/auth/telegram").send({ initData: initData(7011) });
    await request(app).post("/api/app/orders").set("Authorization", `Bearer ${plain.body.token}`).send({ productCode: "be" });
    expect((await prisma.order.findFirstOrThrow({ where: { user: { telegramId: 7011n } } })).linkId).toBeNull();
  });

  it("panel: statistikasi bor link o'chirilmaydi (faqat disable), ishlatilmagani o'chiriladi; mahsulot kodi link bilan to'qnashmaydi", async () => {
    expect((await request(app).delete(`/api/links/${link.id}`).set(admin)).status).toBe(409);
    const unused = await request(app).post("/api/links").set(admin).send({ productId: frontend.id, source: "youtube" });
    expect((await request(app).delete(`/api/links/${unused.body.id}`).set(admin)).status).toBe(200);

    const filtered = await request(app).get(`/api/links?productId=${frontend.id}&status=active`).set(admin);
    expect(filtered.body.items.every((l: { product: { code: string }; isActive: boolean }) => l.product.code === "fe" && l.isActive)).toBe(true);

    const logs = await prisma.activityLog.findMany({ where: { action: { in: ["CREATE_LINK", "UPDATE_LINK", "DELETE_LINK"] } } });
    expect(logs.length).toBeGreaterThanOrEqual(4);
  });

  it("tracking redirect /l/<kod>: bosish yoziladi, faqat botga yo'naltiriladi; noto'g'ri kod — oddiy bot", async () => {
    const res = await request(app).get(`/l/${link.code}`).set("User-Agent", "Instagram 300.0");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`https://t.me/test_bot?start=${link.code}`);
    await request(app).get(`/l/${link.code}`).set("User-Agent", "Instagram 300.0"); // o'sha odam — unique emas
    await request(app).get(`/l/${link.code.toUpperCase()}`).set("User-Agent", "TikTok 1.0");
    await new Promise((r) => setTimeout(r, 50));
    const clicks = await prisma.linkClick.findMany({ where: { linkId: link.id } });
    expect(clicks).toHaveLength(3);
    expect(new Set(clicks.map((c) => c.visitorHash)).size).toBe(2);
    expect(clicks[0].visitorHash).toMatch(/^[0-9a-f]{32}$/); // IP saqlanmaydi

    for (const bad of ["yoq-kod", "..%2F..%2Fetc", "https%3A%2F%2Fevil.com"]) {
      const r = await request(app).get(`/l/${bad}`);
      expect(r.status).toBe(302);
      expect(r.headers.location).toBe("https://t.me/test_bot");
    }
  });

  it("first-touch saqlanadi: boshqa link keyin ochilsa ham birinchi manba o'zgarmaydi; telefon = ro'yxatdan o'tish vaqti", async () => {
    const tiktok = await request(app).post("/api/links").set(admin).send({ productId: frontend.id, source: "tiktok", name: "TikTok reels" });
    expect(tiktok.body.name).toBe("TikTok reels");
    await bot.handleUpdate(start(tiktok.body.code, { id: 7002, first_name: "Vali" }));
    const u = await prisma.user.findUniqueOrThrow({ where: { telegramId: 7002n } });
    expect(u.firstLinkId).toBe(link.id); // instagram — birinchi
    expect(u.lastLinkId).toBe(tiktok.body.id); // oxirgisi — tiktok
    expect(u.firstSource).toBe("instagram");

    const fresh = await prisma.user.create({ data: { telegramId: 7020n, firstName: "R" } });
    await setPhone(fresh.id, "+998900000020", false);
    const reg1 = (await prisma.user.findUniqueOrThrow({ where: { id: fresh.id } })).registeredAt;
    expect(reg1).not.toBeNull();
    await setPhone(fresh.id, "+998900000021", false); // raqam yangilansa — vaqt o'zgarmaydi
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fresh.id } })).registeredAt).toEqual(reg1);
  });

  it("analytics: KPI, funnel, kunlik grafik, kurs va manba/kampaniya kesimlari; davr tekshiriladi", async () => {
    const from = new Date(Date.now() - 86400_000).toISOString();
    const to = new Date(Date.now() + 86400_000).toISOString();
    expect((await request(app).get(`/api/analytics?from=${to}&to=${from}`).set(admin)).status).toBe(400);
    expect((await request(app).get(`/api/analytics?from=2020-01-01&to=2026-01-01`).set(admin)).status).toBe(400);
    expect((await request(app).get(`/api/analytics?from=${from}&to=${to}`)).status).toBe(401);

    const res = await request(app).get(`/api/analytics?from=${from}&to=${to}`).set(admin);
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ purchases: 1, buyers: 1, revenue: 900_000 });
    expect(res.body.funnel.clicks).toBe(2);
    expect(res.body.funnel.started).toBeGreaterThanOrEqual(3);
    expect(res.body.series).toHaveLength(3); // ±24 soat = kecha, bugun, ertaga (Toshkent kunlari; bo'sh kun — 0)
    expect(res.body.series.reduce((a: number, d: { revenue: number }) => a + d.revenue, 0)).toBe(900_000);

    const fe = res.body.courses.find((c: { code: string }) => c.code === "fe");
    expect(fe).toMatchObject({ purchases: 1, buyers: 1, revenue: 900_000 });
    expect(fe.started).toBeGreaterThanOrEqual(2);
    expect(fe.viewed).toBeGreaterThanOrEqual(1);

    const insta = res.body.sources.find((s: { source: string }) => s.source === "instagram");
    expect(insta).toMatchObject({ clicks: 2, purchases: 1, revenue: 900_000 });
    const camp = res.body.campaigns.find((c: { campaign: string | null }) => c.campaign === "Sentabr 2026");
    expect(camp).toMatchObject({ course: "Frontend Development", source: "instagram", purchases: 1 });
    // Link orqali kelmagan buyurtma "organic" qatorida
    expect(res.body.sources.some((s: { source: string; leads: number }) => s.source === "organic" && s.leads >= 1)).toBe(true);

    const links = await request(app).get("/api/links").set(admin);
    const row = links.body.items.find((l: { id: number }) => l.id === link.id);
    expect(row.stats).toMatchObject({ clicks: 3, uniqueClicks: 2, users: 2, registered: 1, buyers: 1 });
    expect(row.urls.tracked).toBe(`https://app.example.uz/l/${link.code}`);
  });

  it("foydalanuvchilar: kurs, manba, kampaniya, xarid, ro'yxatdan o'tish va sana filtrlari; xarid summasi", async () => {
    const list = (qs: string) => request(app).get(`/api/telegram-users?${qs}`).set(admin);
    const ids = async (qs: string) => (await list(qs)).body.items.map((u: { telegramId: string }) => u.telegramId).sort();

    expect(await ids(`productId=${frontend.id}&purchased=yes`)).toEqual(["7002"]);
    expect(await ids("source=instagram")).toEqual(expect.arrayContaining(["7002", "7010"]));
    expect(await ids("campaign=Sentabr%202026")).toEqual(expect.arrayContaining(["7002"]));
    expect(await ids("purchased=yes")).toEqual(["7002"]);
    expect((await ids("registered=no")).includes("7002")).toBe(false);
    expect(await ids(`from=${new Date(Date.now() + 86400_000).toISOString()}`)).toEqual([]);

    const vali = (await list("purchased=yes")).body.items[0];
    expect(vali.purchase).toMatchObject({ count: 1, amount: 900_000 });
    expect(vali.firstLink).toMatchObject({ source: "instagram", campaign: "Sentabr 2026", product: { title: "Frontend Development" } });

    const filters = await request(app).get("/api/telegram-users/filters").set(admin);
    expect(filters.body.sources).toContain("instagram");
    expect(filters.body.campaigns).toContain("Sentabr 2026");
    expect((await list("purchased=maybe")).status).toBe(400);
  });

  it("kurs bo'limlari: faqat to'ldirilgan bo'lim tugmasi chiqadi, bo'lim matni to'g'ri; HTML escape", async () => {
    const callbackData = () =>
      calls.flatMap((c) => {
        const kb = c.payload.reply_markup as { inline_keyboard?: { callback_data?: string }[][] } | undefined;
        return (kb?.inline_keyboard ?? []).flat().flatMap((b) => (b.callback_data ? [b.callback_data] : []));
      });
    const cb = (data: string): Update => ({
      update_id: updateId++,
      callback_query: {
        id: String(updateId),
        from: { id: 7002, is_bot: false, first_name: "Vali" },
        chat_instance: "ci",
        data,
        message: { message_id: 1, date: 0, chat: { id: 7002, type: "private", first_name: "Vali" }, text: "x" },
      },
    });

    // Ma'lumot yo'q — faqat narx bo'limi bor, bo'lim tugmalari chiqmaydi (ekran avvalgidek)
    await bot.handleUpdate(cb("p:be"));
    expect(callbackData().some((d) => d.startsWith("pi:"))).toBe(false);

    await prisma.product.update({
      where: { code: "fe" },
      data: { duration: "3 oy", lessonsCount: 36, startDate: new Date("2026-10-01"), teacher: "Aziz <b>aka</b>", program: "1. HTML\n2. CSS" },
    });
    calls.length = 0;
    await bot.handleUpdate(cb("p:fe"));
    expect(callbackData()).toEqual(expect.arrayContaining(["pi:fe:about", "pi:fe:price", "pi:fe:program", "pi:fe:teacher", "buy:fe"]));

    calls.length = 0;
    await bot.handleUpdate(cb("pi:fe:about"));
    const about = texts().join("\n");
    expect(about).toContain("3 oy");
    expect(about).toContain("36");
    expect(about).toContain("01.10.2026");

    calls.length = 0;
    await bot.handleUpdate(cb("pi:fe:teacher"));
    expect(texts().join("\n")).toContain("Aziz &lt;b&gt;aka&lt;/b&gt;"); // foydalanuvchi matni HTML sifatida emas

    calls.length = 0;
    await bot.handleUpdate(cb("pi:yoq:about"));
    expect(calls.some((c) => c.method === "answerCallbackQuery")).toBe(true);
  });
});
