import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GrammyError, type Bot } from "grammy";
import type { Message, Update, UserFromGetMe } from "grammy/types";
import { prisma } from "../src/db";
import { createBot } from "../src/bot/bot";
import type { BotContext } from "../src/bot/context";
import { addCard } from "../src/services/cards";
import { invalidateSettings, setSetting } from "../src/services/settings";
import { saveEditableTexts } from "../src/services/texts";
import { invalidateTexts } from "../src/i18n";
import { uz } from "../src/i18n/locales/uz";
import { extractLessonMedia, moveLesson } from "../src/services/lessons";
import { approveAndNotify } from "../src/bot/admin/reviewActions";

const enabled = !!process.env.TEST_DATABASE_URL;

// ---------- Soxta Telegram ----------

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
/** Keyingi sendVideo shu xato bilan tugaydi */
let failVideo: GrammyError | null = null;

function makeBot(): Bot<BotContext> {
  const bot = createBot("123:test-token", { botInfo: BOT_INFO });
  bot.api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    if (failVideo && method === "sendVideo") {
      const err = failVideo;
      failVideo = null;
      throw err;
    }
    const message = { message_id: ++seq, date: 0, chat: { id: Number(p.chat_id), type: "private" } };
    const result = method === "getMe" ? BOT_INFO : method.startsWith("send") || method === "editMessageText" ? message : true;
    return { ok: true, result } as unknown as Awaited<ReturnType<typeof _prev>>;
  });
  return bot;
}

interface TgUser {
  id: number;
  is_bot: false;
  first_name: string;
}

const AZIZ: TgUser = { id: 5001, is_bot: false, first_name: "Aziz" };
const ADMIN: TgUser = { id: 9001, is_bot: false, first_name: "Admin" };
let updateId = 1;
const now = () => Math.floor(Date.now() / 1000);
const chatOf = (u: TgUser) => ({ id: u.id, type: "private" as const, first_name: u.first_name });

function msg(from: TgUser, extra: Record<string, unknown>): Update {
  return { update_id: updateId++, message: { message_id: ++seq, date: now(), chat: chatOf(from), from, ...extra } as NonNullable<Update["message"]> };
}
const text = (t: string, from: TgUser = AZIZ) =>
  msg(from, { text: t, entities: t.startsWith("/") ? [{ type: "bot_command", offset: 0, length: t.split(" ")[0].length }] : undefined });

/** Video: hajmi Telegram limitlariga yaqin (3.5 GB) — kodda sun'iy limit yo'qligini tekshirish uchun */
const video = (from: TgUser, uniq = "vu1", extra: Record<string, unknown> = {}) =>
  msg(from, {
    video: { file_id: `vid-${uniq}`, file_unique_id: uniq, width: 1920, height: 1080, duration: 3725, mime_type: "video/mp4", file_name: "dars.mp4", file_size: 3_500_000_000 },
    caption: "1-dars: Kirish\nBatafsil izoh",
    ...extra,
  });

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

const sent = () => calls.filter((c) => ["sendMessage", "editMessageText"].includes(c.method));
const lastText = () => String(sent().at(-1)?.payload.text ?? "");
const answers = () => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => String(c.payload.text ?? ""));

interface Button {
  text: string;
  callback_data?: string;
  url?: string;
}
function buttons(c: Call | undefined): Button[] {
  const markup = c?.payload.reply_markup as { inline_keyboard?: Button[][]; keyboard?: { text: string }[][] } | undefined;
  if (markup?.inline_keyboard) return markup.inline_keyboard.flat();
  return (markup?.keyboard ?? []).flat().map((b) => ({ text: b.text }));
}
const lastButtons = () => buttons(sent().at(-1));

async function reset() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE bot_state, notifications, events, audit_log, messages, access_grants, receipts, orders, cards, products, admins, settings, texts, users RESTART IDENTITY CASCADE`,
  );
  invalidateSettings();
  invalidateTexts();
  await prisma.product.createMany({
    data: [
      { code: "js", title: "JavaScript", price: 500_000, channelId: -1001n, sortOrder: 1 },
      { code: "py", title: "Python", price: 400_000, channelId: -1002n, sortOrder: 2 },
    ],
  });
  await addCard("8600123412341234", "A. Karimov");
  await prisma.admin.create({ data: { telegramId: BigInt(ADMIN.id), role: "admin", name: "Admin" } });
  calls = [];
}

/** Xaridor: telefon bor, kursga faol kirish bor */
async function makeBuyer(productCode: string) {
  const user = await prisma.user.create({ data: { telegramId: BigInt(AZIZ.id), firstName: "Aziz", phone: "+998901234567" } });
  const product = await prisma.product.findUniqueOrThrow({ where: { code: productCode } });
  const order = await prisma.order.create({ data: { userId: user.id, productId: product.id, amount: product.price, status: "approved", expiresAt: new Date(), paidAt: new Date() } });
  await prisma.accessGrant.create({ data: { userId: user.id, productId: product.id, orderId: order.id } });
  return user;
}

describe("extractLessonMedia", () => {
  const base = { message_id: 1, date: 0, chat: { id: 1, type: "private" as const, first_name: "A" } };
  it("video, video-fayl va forward qabul qilinadi; rasm, PDF, GIF, dumaloq video rad etiladi", () => {
    const v = extractLessonMedia({ ...base, video: { file_id: "f", file_unique_id: "u", width: 1, height: 1, duration: 5, file_size: 4_000_000_000 } } as Message);
    expect(v.ok && v.media.fileSize).toBe(4_000_000_000n);
    const doc = extractLessonMedia({ ...base, document: { file_id: "d", file_unique_id: "du", mime_type: "video/quicktime", file_name: "a.mov" } } as Message);
    expect(doc.ok && doc.media.mediaType).toBe("document");
    const pdf = extractLessonMedia({ ...base, document: { file_id: "d", file_unique_id: "du", mime_type: "application/pdf" } } as Message);
    expect(pdf).toEqual({ ok: false, reason: "document" });
    expect(extractLessonMedia({ ...base, photo: [{ file_id: "p", file_unique_id: "pu", width: 1, height: 1 }] } as Message)).toEqual({ ok: false, reason: "photo" });
    expect(extractLessonMedia({ ...base, video_note: { file_id: "n", file_unique_id: "nu", length: 1, duration: 1 } } as Message)).toEqual({ ok: false, reason: "video_note" });
    expect(extractLessonMedia({ ...base, animation: { file_id: "a", file_unique_id: "au", width: 1, height: 1, duration: 1 }, document: { file_id: "a", file_unique_id: "au" } } as Message)).toEqual({
      ok: false,
      reason: "animation",
    });
    expect(extractLessonMedia({ ...base, text: "salom", forward_origin: { type: "hidden_user", sender_user_name: "X", date: 0 } } as Message)).toEqual({
      ok: false,
      reason: "forward_without_video",
    });
  });
});

describe.skipIf(!enabled)("kurs darslari va menyu (integratsion)", () => {
  let bot: Bot<BotContext>;
  beforeEach(async () => {
    await reset();
    bot = makeBot();
  });
  afterAll(() => prisma.$disconnect());

  const send = async (...updates: Update[]) => {
    for (const u of updates) await bot.handleUpdate(u);
  };

  // ---------- Menyu ----------

  it("TEST 1: oddiy foydalanuvchi menyusi — faqat Darsliklar va Yordam", async () => {
    await prisma.user.create({ data: { telegramId: BigInt(AZIZ.id), firstName: "Aziz", phone: "+998901234567" } });
    await send(text("/start"));
    const menu = sent().find((c) => (c.payload.reply_markup as { keyboard?: unknown } | undefined)?.keyboard);
    expect(buttons(menu).map((b) => b.text)).toEqual([uz.menu_products, uz.menu_help]);
  });

  it("TEST 2: admin menyusi — Darsliklar, Yordam va Admin panel", async () => {
    await prisma.user.create({ data: { telegramId: BigInt(ADMIN.id), firstName: "Admin", phone: "+998901111111" } });
    await send(text("/start", ADMIN));
    const menu = sent().find((c) => (c.payload.reply_markup as { keyboard?: unknown } | undefined)?.keyboard);
    expect(buttons(menu).map((b) => b.text)).toEqual([uz.menu_products, uz.menu_help, uz.menu_admin]);
  });

  it("oddiy foydalanuvchi /admin, «Admin panel» matni va admin callback'lariga — ruxsat yo'q", async () => {
    await prisma.user.create({ data: { telegramId: BigInt(AZIZ.id), firstName: "Aziz", phone: "+998901234567" } });
    await send(text("/admin"));
    expect(lastText()).toBe(uz.adm_no_permission);
    await send(text(uz.menu_admin));
    expect(lastText()).toBe(uz.adm_no_permission);
    calls = [];
    await send(callback("ap:lessons"), callback("al:add"), callback("al:delok:1"), callback("ax:f:a:xlsx"), callback("ap:export"));
    expect(answers()).toEqual(Array(5).fill(uz.adm_no_permission));
    expect(calls.some((c) => c.method === "sendDocument")).toBe(false);
  });

  it("oddiy foydalanuvchi video yuborsa — dars yaratilmaydi", async () => {
    await prisma.user.create({ data: { telegramId: BigInt(AZIZ.id), firstName: "Aziz", phone: "+998901234567" } });
    await send(video(AZIZ));
    expect(await prisma.lesson.count()).toBe(0);
    expect(lastText()).not.toContain("Video qabul qilindi");
  });

  // ---------- Admin: video qo'shish ----------

  it("TEST 3 + TEST 11: admin video yuboradi (3.5 GB) → kurs → nom → dars saqlanadi, fayl yuklab olinmaydi", async () => {
    await send(video(ADMIN));
    expect(lastText()).toContain("Video qabul qilindi");
    expect(lastText()).toContain("1:02:05");
    const course = await prisma.product.findUniqueOrThrow({ where: { code: "js" } });
    expect(lastButtons().some((b) => b.callback_data === `al:pick:${course.id}`)).toBe(true);

    await send(callback(`al:pick:${course.id}`, ADMIN));
    expect(lastText()).toContain("Bu video nima bo'ladi?");
    await send(callback("al:kind:l", ADMIN));
    expect(lastText()).toContain("Dars nomini kiriting");
    await send(text("1-dars: JavaScript Introduction", ADMIN));
    expect(lastText()).toContain("Video kursga muvaffaqiyatli qo'shildi");

    const lesson = await prisma.lesson.findFirstOrThrow();
    expect(lesson).toMatchObject({
      productId: course.id,
      title: "1-dars: JavaScript Introduction",
      telegramFileId: "vid-vu1",
      telegramFileUniqueId: "vu1",
      mediaType: "video",
      fileSize: 3_500_000_000n,
      duration: 3725,
      caption: "1-dars: Kirish\nBatafsil izoh",
    });
    // Server faylni Telegram'dan yuklab olmaydi va qayta yuklamaydi
    expect(calls.some((c) => c.method === "getFile" || (c.method.startsWith("send") && typeof c.payload.video === "object"))).toBe(false);
  });

  it("TEST 4: forward qilingan video aniqlanadi va kursga biriktiriladi (izoh nom sifatida)", async () => {
    const course = await prisma.product.findUniqueOrThrow({ where: { code: "py" } });
    await send(callback(`al:add:${course.id}`, ADMIN));
    expect(lastText()).toContain("Video yuboring yoki Telegramdan video forward qiling");
    await send(video(ADMIN, "fw1", { forward_origin: { type: "channel", chat: { id: -100555, type: "channel", title: "Kanal" }, message_id: 12, date: 0 } }));
    // Kurs oldindan tanlangan — darhol nom so'raladi
    expect(lastText()).toContain("Dars nomini kiriting");
    await send(callback("al:usecap", ADMIN));
    expect(lastText()).toContain("Video kursga muvaffaqiyatli qo'shildi");
    expect(await prisma.lesson.findFirstOrThrow()).toMatchObject({ productId: course.id, title: "1-dars: Kirish", telegramFileUniqueId: "fw1" });
  });

  it("noto'g'ri media: rasm, PDF, videosiz forward — aniq sabab; bir video ikki marta qo'shilmaydi", async () => {
    await send(callback("al:add", ADMIN));
    await send(msg(ADMIN, { photo: [{ file_id: "p", file_unique_id: "pu", width: 1, height: 1 }] }));
    expect(lastText()).toContain("Bu rasm");
    await send(msg(ADMIN, { document: { file_id: "d", file_unique_id: "du", mime_type: "application/pdf", file_name: "a.pdf" } }));
    expect(lastText()).toContain("video emas");
    await send(msg(ADMIN, { text: "salom", forward_origin: { type: "hidden_user", sender_user_name: "X", date: 0 } }));
    expect(lastText()).toContain("Forward qilingan xabarda video yo'q");
    expect(await prisma.lesson.count()).toBe(0);

    const course = await prisma.product.findUniqueOrThrow({ where: { code: "js" } });
    await send(video(ADMIN, "dup"), callback(`al:pick:${course.id}`, ADMIN), callback("al:kind:l", ADMIN), text("Dars", ADMIN));
    await send(video(ADMIN, "dup"), callback(`al:pick:${course.id}`, ADMIN), callback("al:kind:l", ADMIN));
    expect(lastText()).toContain("allaqachon qo'shilgan");
    expect(await prisma.lesson.count()).toBe(1);
  });

  it("menyu tugmasi nom kutilayotganda bosilsa — oqim to'xtaydi, dars menyu nomi bilan yaratilmaydi", async () => {
    const course = await prisma.product.findUniqueOrThrow({ where: { code: "js" } });
    await send(video(ADMIN), callback(`al:pick:${course.id}`, ADMIN), callback("al:kind:l", ADMIN), text(uz.menu_help, ADMIN));
    expect(await prisma.lesson.count()).toBe(0);
    expect(lastText()).toContain("Yordam");
  });

  it("admin: nomini o'zgartirish, tartib, o'chirish", async () => {
    const course = await prisma.product.findUniqueOrThrow({ where: { code: "js" } });
    await send(video(ADMIN, "a"), callback(`al:pick:${course.id}`, ADMIN), callback("al:kind:l", ADMIN), text("Birinchi", ADMIN));
    await send(video(ADMIN, "b"), callback(`al:pick:${course.id}`, ADMIN), callback("al:kind:l", ADMIN), text("Ikkinchi", ADMIN));
    const [a, b] = await prisma.lesson.findMany({ orderBy: { sortOrder: "asc" } });

    await send(callback(`al:rn:${a.id}`, ADMIN), text("Kirish darsi", ADMIN));
    expect((await prisma.lesson.findUniqueOrThrow({ where: { id: a.id } })).title).toBe("Kirish darsi");

    await send(callback(`al:dn:${a.id}`, ADMIN));
    const order = (await prisma.lesson.findMany({ orderBy: { sortOrder: "asc" } })).map((l) => l.id);
    expect(order).toEqual([b.id, a.id]);
    expect(await moveLesson(b.id, "up")).toBe(false);

    await send(callback(`al:delok:${b.id}`, ADMIN));
    expect(await prisma.lesson.count()).toBe(1);
  });

  // ---------- Xaridor ----------

  it("TEST 5: kursni sotib olgan foydalanuvchiga video file_id orqali yuboriladi", async () => {
    await makeBuyer("js");
    const course = await prisma.product.findUniqueOrThrow({ where: { code: "js" } });
    await send(video(ADMIN, "v1"), callback(`al:pick:${course.id}`, ADMIN), callback("al:kind:l", ADMIN), text("Kirish", ADMIN));
    const lesson = await prisma.lesson.findFirstOrThrow();
    calls = [];

    // Kurs sahifasi: darslar ro'yxati va kanal havolasi
    await send(callback("p:js"));
    expect(lastText()).toContain(uz.course_owned.slice(0, 2));
    expect(lastButtons().map((b) => b.callback_data)).toEqual(expect.arrayContaining([`l:${lesson.id}`, expect.stringMatching(/^link:\d+$/)]));

    await send(callback(`l:${lesson.id}`));
    const v = calls.find((c) => c.method === "sendVideo");
    expect(v?.payload).toMatchObject({ chat_id: AZIZ.id, video: "vid-v1", supports_streaming: true });
    expect(String(v?.payload.caption)).toContain("1. Kirish");
  });

  it("TEST 6: sotib olmagan foydalanuvchiga video yuborilmaydi (dars ID si qo'lda yuborilsa ham)", async () => {
    await makeBuyer("py"); // boshqa kursning egasi
    const course = await prisma.product.findUniqueOrThrow({ where: { code: "js" } });
    await send(video(ADMIN, "v2"), callback(`al:pick:${course.id}`, ADMIN), callback("al:kind:l", ADMIN), text("Yopiq dars", ADMIN));
    const lesson = await prisma.lesson.findFirstOrThrow();
    calls = [];

    await send(callback(`l:${lesson.id}`));
    expect(answers()).toContain(uz.lesson_locked);
    expect(calls.some((c) => c.method === "sendVideo" || c.method === "sendDocument")).toBe(false);

    // Kurs sahifasida darslar 🔒 bilan ko'rinadi
    await send(callback("p:js"));
    expect(lastButtons().some((b) => b.callback_data === "ls:js:1")).toBe(true);
    await send(callback("ls:js:1"));
    expect(lastButtons().find((b) => b.callback_data === `l:${lesson.id}`)?.text).toContain("🔒");
  });

  it("kurs sotuvdan olinsa ham xaridor katalogda ko'radi, darslar ochiladi; boshqalar ko'rmaydi", async () => {
    await makeBuyer("js");
    const course = await prisma.product.findUniqueOrThrow({ where: { code: "js" } });
    await send(video(ADMIN, "inact"), callback(`al:pick:${course.id}`, ADMIN), callback("al:kind:l", ADMIN), text("Dars", ADMIN));
    await prisma.product.update({ where: { id: course.id }, data: { isActive: false } });
    calls = [];
    await send(callback("nav:cat:1"));
    expect(lastButtons().some((b) => b.callback_data === "p:js" && b.text.startsWith("✅"))).toBe(true);
    await send(callback("p:js"));
    expect(lastButtons().some((b) => b.callback_data?.startsWith("l:"))).toBe(true);

    // Sotib olmagan foydalanuvchi uchun sotuvdan olingan kurs mavjud emas
    await prisma.user.create({ data: { telegramId: 5002n, firstName: "Boshqa", phone: "+998901111112" } });
    const other = { id: 5002, is_bot: false as const, first_name: "Boshqa" };
    await send(callback("nav:cat:1", other));
    expect(lastButtons().some((b) => b.callback_data === "p:js")).toBe(false);
    await send(callback("p:js", other));
    expect(answers()).toContain(uz.error_not_found);
  });

  it("paneldan tahrirlangan tanishtiruv/to'lov matnlari va kurs nomi uzunligi botda darhol ishlatiladi", async () => {
    await prisma.user.create({ data: { telegramId: BigInt(AZIZ.id), firstName: "Aziz", phone: "+998901234567" } });
    await prisma.product.update({ where: { code: "js" }, data: { title: "Node js kursi", videoFileId: "intro-js" } });
    await saveEditableTexts("uz", {
      intro_video_text: "Yangi <b>tanishtiruv</b> matni 🎬",
      payment_step_1: "1️⃣ {summa} ni o'tkazing.",
      payment_step_2: "2️⃣ Chekni yuboring.",
      payment_expires: "⏳ Muddat: {expires_at}.",
    });
    await setSetting("course_name_max_length", 7);

    calls = [];
    await send(callback("p:js"));
    const intro = calls.find((c) => c.method === "sendVideo")!;
    expect(String(intro.payload.caption)).toBe("🎥 <b>Node js</b> — tanishtiruv videosi\n\nYangi <b>tanishtiruv</b> matni 🎬");
    expect(String(intro.payload.parse_mode)).toBe("HTML");

    calls = [];
    await send(callback("nav:cat:1"));
    expect(lastButtons().some((b) => b.text.startsWith("Node js —") || b.text === "Node js")).toBe(true);
    expect(lastButtons().some((b) => b.text.includes("Node js kursi"))).toBe(false);

    calls = [];
    await send(callback("buy:js"));
    const pay = lastText();
    const order = await prisma.order.findFirstOrThrow({ where: { product: { code: "js" } } });
    const expires = order.expiresAt.toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "");
    expect(pay).toContain("Darslik: Node js\n");
    expect(pay).toContain("1️⃣ 500 000 so'm ni o'tkazing.\n2️⃣ Chekni yuboring.");
    expect(pay).toContain(`⏳ Muddat: ${expires}.`);
    expect(pay).not.toContain("{expires_at}");

    // Limit o'zgardi — keyingi ekranda darhol; bazadagi nom o'zgarmagan
    await setSetting("course_name_max_length", 10);
    calls = [];
    await send(callback("nav:cat:1"));
    expect(lastButtons().some((b) => b.text.startsWith("Node js ku"))).toBe(true);
    expect((await prisma.product.findUniqueOrThrow({ where: { code: "js" } })).title).toBe("Node js kursi");
  });

  it("TEST 6 + 7: sotib olmagan foydalanuvchi kursni tanlaydi — tanishtiruv video, tavsif, narx, Sotib olish; darslar yopiq; Mini App yo'q", async () => {
    await prisma.user.create({ data: { telegramId: BigInt(AZIZ.id), firstName: "Aziz", phone: "+998901234567" } });
    await prisma.product.update({ where: { code: "js" }, data: { videoFileId: "intro-js", description: "JavaScript asoslari" } });
    const course = await prisma.product.findUniqueOrThrow({ where: { code: "js" } });
    await send(video(ADMIN, "main1"), callback(`al:pick:${course.id}`, ADMIN), callback("al:kind:l", ADMIN), text("Asosiy dars", ADMIN));
    calls = [];

    await send(callback("p:js"));
    // Avval tanishtiruv videosi, keyin alohida xabarda tavsif, narx va «Sotib olish»
    const order = calls.filter((c) => c.method === "sendVideo" || c.method === "sendMessage");
    expect(order.map((c) => c.method)).toEqual(["sendVideo", "sendMessage"]);
    const [intro, info] = order;
    expect(intro.payload.video).toBe("intro-js"); // tanishtiruv (preview) videosi — ochiq
    expect(String(intro.payload.caption)).toContain("tanishtiruv videosi");
    expect(String(info.payload.text)).toContain("JavaScript asoslari");
    expect(String(info.payload.text)).toContain("500 000");
    const kb = buttons(info);
    expect(kb.some((b) => b.callback_data === "buy:js")).toBe(true);
    // Kurs kartochkasi: «Darslikni olaman» va «Bosh menyu» bor, «Orqaga» yo'q
    expect(kb.some((b) => b.callback_data === "nav:home")).toBe(true);
    expect(kb.some((b) => b.text === uz.btn_back || b.callback_data === "nav:cat:1")).toBe(false);
    // «Savol berish» (support URL) tugmasi ham yo'q
    await setSetting("support_username", "my_support");
    calls = [];
    await send(callback("p:js"));
    expect(lastButtons().some((b) => b.url)).toBe(false);
    expect([...kb, ...buttons(intro)].some((b) => (b as { web_app?: unknown }).web_app)).toBe(false);
    // Asosiy dars videosi yuborilmagan
    expect(calls.filter((c) => c.method === "sendVideo").map((c) => c.payload.video)).toEqual(["intro-js"]);
  });

  it("admin tanishtiruv videosini botdan qo'shadi: video → kurs → «Tanishtiruv videosi»; dars yaratilmaydi, foydalanuvchiga avval shu video", async () => {
    const course = await prisma.product.findUniqueOrThrow({ where: { code: "py" } });
    expect(course.videoFileId).toBeNull();
    await send(video(ADMIN, "intro1"), callback(`al:pick:${course.id}`, ADMIN), callback("al:kind:i", ADMIN));
    expect(lastText()).toContain("Tanishtiruv videosi saqlandi");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: course.id } })).videoFileId).toBe("vid-intro1");
    expect(await prisma.lesson.count()).toBe(0);

    // Kurs ekranidan almashtirish: kurs oldindan tanlangan — video darhol tanishtiruv bo'ladi
    await send(callback(`al:intro:${course.id}`, ADMIN), video(ADMIN, "intro2"));
    expect((await prisma.product.findUniqueOrThrow({ where: { id: course.id } })).videoFileId).toBe("vid-intro2");
    // «Fayl sifatida» yuborilgan video tanishtiruvga yaramaydi (sendVideo bilan ochilmaydi)
    await send(callback(`al:intro:${course.id}`, ADMIN), msg(ADMIN, { document: { file_id: "doc-v", file_unique_id: "dv", mime_type: "video/mp4" } }));
    expect(lastText()).toContain("oddiy video");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: course.id } })).videoFileId).toBe("vid-intro2");

    await prisma.user.create({ data: { telegramId: BigInt(AZIZ.id), firstName: "Aziz", phone: "+998901234567" } });
    calls = [];
    await send(callback("p:py"));
    expect(calls.find((c) => c.method === "sendVideo")?.payload.video).toBe("vid-intro2");
  });

  it("TEST 8 + 9: to'lov tasdiqlanadi — buyurtma va kirish bazada, «To'lov muvaffaqiyatli» + «📚 Kursni boshlash» (xaridlar bo'limisiz); darslar ochiladi", async () => {
    const user = await prisma.user.create({ data: { telegramId: BigInt(AZIZ.id), firstName: "Aziz", phone: "+998901234567" } });
    const course = await prisma.product.findUniqueOrThrow({ where: { code: "js" } });
    await send(video(ADMIN, "main2"), callback(`al:pick:${course.id}`, ADMIN), callback("al:kind:l", ADMIN), text("1-dars", ADMIN));
    await send(callback("buy:js"));
    const order = await prisma.order.findFirstOrThrow({ where: { userId: user.id } });
    await prisma.order.update({ where: { id: order.id }, data: { status: "receipt_sent" } });
    const admin = await prisma.admin.findFirstOrThrow();
    calls = [];

    expect(await approveAndNotify(bot.api, order.id, { adminId: admin.id })).toBe(true);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "approved" });
    expect(await prisma.accessGrant.count({ where: { userId: user.id, productId: course.id, revokedAt: null } })).toBe(1);
    const msgToUser = calls.find((c) => c.method === "sendMessage" && c.payload.chat_id === AZIZ.id);
    expect(String(msgToUser?.payload.text)).toContain("To'lov muvaffaqiyatli");
    expect(buttons(msgToUser).find((b) => b.callback_data === "p:js")?.text).toBe(uz.btn_start_course);
    expect(buttons(msgToUser).some((b) => /xarid/i.test(b.text))).toBe(false);

    // «Kursni boshlash» → darslar
    await send(callback("p:js"));
    const lesson = await prisma.lesson.findFirstOrThrow();
    expect(lastButtons().some((b) => b.callback_data === `l:${lesson.id}`)).toBe(true);
  });

  it("«Mening xaridlarim» yo'q: eski tugma, buyruq va matn hech narsa ochmaydi", async () => {
    await makeBuyer("js");
    calls = [];
    await send(callback("nav:pur:1"), callback("purchases"));
    expect(answers().every((a) => a === uz.error_stale_button)).toBe(true);
    await send(text("/purchases"));
    expect(lastText()).toBe(uz.error_unknown_command);
    await send(text("🧾 Mening xaridlarim"));
    expect(lastText()).not.toMatch(/xaridlarim/i);
    const all = calls.map((c) => JSON.stringify(c.payload)).join("\n");
    expect(all).not.toMatch(/xaridlarim|nav:pur|web_app/i);
  });

  it("muddati o'tgan yoki bekor qilingan kirish bilan video yuborilmaydi", async () => {
    const user = await makeBuyer("js");
    const course = await prisma.product.findUniqueOrThrow({ where: { code: "js" } });
    await send(video(ADMIN, "v3"), callback(`al:pick:${course.id}`, ADMIN), callback("al:kind:l", ADMIN), text("Dars", ADMIN));
    const lesson = await prisma.lesson.findFirstOrThrow();
    await prisma.accessGrant.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    calls = [];
    await send(callback(`l:${lesson.id}`));
    expect(answers()).toContain(uz.lesson_locked);
    expect(calls.some((c) => c.method === "sendVideo")).toBe(false);
  });

  it("Telegram'da video topilmasa — foydalanuvchiga tushunarli xabar, stack trace yo'q", async () => {
    await makeBuyer("js");
    const course = await prisma.product.findUniqueOrThrow({ where: { code: "js" } });
    await send(video(ADMIN, "v4"), callback(`al:pick:${course.id}`, ADMIN), callback("al:kind:l", ADMIN), text("Dars", ADMIN));
    const lesson = await prisma.lesson.findFirstOrThrow();
    failVideo = new GrammyError("Call to 'sendVideo' failed!", { ok: false, error_code: 400, description: "Bad Request: wrong file identifier/HTTP URL specified" }, "sendVideo", {});
    calls = [];
    await send(callback(`l:${lesson.id}`));
    expect(lastText()).toBe(uz.lesson_unavailable);
  });

  it("TEST 12: ko'p foydalanuvchi bir vaqtda video so'raydi — barchasi yuboriladi, event loop bloklanmaydi", async () => {
    const course = await prisma.product.findUniqueOrThrow({ where: { code: "js" } });
    await send(video(ADMIN, "bulk"), callback(`al:pick:${course.id}`, ADMIN), callback("al:kind:l", ADMIN), text("Ommaviy", ADMIN));
    const lesson = await prisma.lesson.findFirstOrThrow();
    const N = 40;
    for (let i = 0; i < N; i++) {
      const u = await prisma.user.create({ data: { telegramId: BigInt(7000 + i), firstName: `U${i}`, phone: "+998900000000" } });
      const o = await prisma.order.create({ data: { userId: u.id, productId: course.id, amount: 1, status: "approved", expiresAt: new Date() } });
      await prisma.accessGrant.create({ data: { userId: u.id, productId: course.id, orderId: o.id } });
    }
    calls = [];
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    await Promise.all(Array.from({ length: N }, (_, i) => bot.handleUpdate(callback(`l:${lesson.id}`, { id: 7000 + i, is_bot: false, first_name: `U${i}` }))));
    clearInterval(timer);
    expect(calls.filter((c) => c.method === "sendVideo")).toHaveLength(N);
    expect(ticks).toBeGreaterThan(0);
  });
});
