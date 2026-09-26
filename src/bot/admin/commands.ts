import { Composer, InlineKeyboard } from "grammy";
import { ChannelInputError, resolveChannelId } from "../../services/channels";
import type { Prisma } from "@prisma/client";
import type { BotContext } from "../context";
import { postReceiptCard } from "./receiptCard";
import { adminsSummary, cardsSummary, productsSummary } from "./summaries";
import { adminHomeScreen } from "../screens/admin";
import { render } from "../ui/render";
import { escapeHtml, formatShortDateTime, formatSum } from "../../lib/format";
import { z } from "zod";
import { SharedState } from "../../services/sharedState";
import { prisma } from "../../db";
import { pendingReceiptOrders } from "../../services/orders";
import { addCard, deleteCard, setCardActive } from "../../services/cards";
import { addAdmin, removeAdmin } from "../../services/admins";
import { can, type Permission } from "../../services/permissions";
import { audit } from "../../services/events";
import { setSetting } from "../../services/settings";
import { displayName } from "../../services/users";

export const adminCommands = new Composer<BotContext>();

/** Ruxsat markazlashtirilgan: services/permissions.ts dagi jadval */
const allowed = (permission: Permission) => (ctx: BotContext) => can(ctx.role, permission);
const admins = adminCommands.filter(allowed("orders.review"));
const productManagers = adminCommands.filter(allowed("products.manage"));
const cardManagers = adminCommands.filter(allowed("cards.manage"));
const adminManagers = adminCommands.filter(allowed("admins.manage"));
const settingsManagers = adminCommands.filter(allowed("settings.manage"));

admins.command("admin", async (ctx) => {
  await render(ctx, await adminHomeScreen(ctx));
});

async function showPending(ctx: BotContext) {
  const orders = await pendingReceiptOrders(10);
  if (orders.length === 0) {
    await ctx.reply("Kutilayotgan cheklar yo'q ✅");
    return;
  }
  await ctx.reply(`Kutilayotgan cheklar: ${orders.length}${orders.length === 10 ? "+" : ""}`);
  for (const o of orders) await postReceiptCard(ctx.api, ctx.chat!.id, o.id);
}

admins.command("pending", showPending);
admins.callbackQuery("adm:pending", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPending(ctx);
});

// ---------- Admin guruhi ----------
settingsManagers.command("setgroup", async (ctx) => {
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    await ctx.reply("Bu buyruqni admin guruhida yozing.");
    return;
  }
  await setSetting("admin_group_id", String(ctx.chat.id));
  await audit(ctx.admin!.id, "set_admin_group", "settings", "admin_group_id", null, { chatId: ctx.chat.id });
  await ctx.reply(`✅ Admin guruhi o'rnatildi: <code>${ctx.chat.id}</code>`, { parse_mode: "HTML" });
});

// ---------- Mahsulotlar ----------
function args(ctx: BotContext): string[] {
  return String(ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
}

function rest(ctx: BotContext): string {
  return String(ctx.match ?? "").trim().replace(/^\S+\s*/, "");
}

// Panel bilan bir xil chegaralar (api/routes/products.ts)
const TITLE_MAX = 100;
const DESC_MAX = 900;
const PRICE_MAX = 1_000_000_000;

async function productOrFail(ctx: BotContext, code: string | undefined) {
  const p = code ? await prisma.product.findFirst({ where: { code: code.toLowerCase(), deletedAt: null } }) : null;
  if (!p) await ctx.reply("Mahsulot topilmadi. Kodlar: /products");
  return p;
}

productManagers.command("products", async (ctx) => {
  await ctx.reply(await productsSummary(ctx.api), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
});

productManagers.command("addproduct", async (ctx) => {
  const [code] = args(ctx);
  const title = rest(ctx);
  if (!code || !title || !/^[a-z0-9-]{1,20}$/i.test(code)) {
    return void (await ctx.reply("Format: /addproduct <kod> <nomi>  (kod: 1–20 ta harf, raqam yoki «-», masalan 4b)"));
  }
  if (title.length > TITLE_MAX) return void (await ctx.reply(`Nomi ${TITLE_MAX} belgidan oshmasin.`));
  const lower = code.toLowerCase();
  // Panel bilan bir xil qoidalar: kod band bo'lmasin (mahsulot yoki kampaniya linki — deep link chalkashmasin)
  const [taken, linkTaken] = await Promise.all([
    prisma.product.findUnique({ where: { code: lower }, select: { id: true } }),
    prisma.campaignLink.findUnique({ where: { code: lower }, select: { id: true } }),
  ]);
  if (taken || linkTaken) return void (await ctx.reply(`«${lower}» kodi band (${taken ? "mahsulot" : "kampaniya linki"}). Boshqa kod tanlang.`));
  const p = await prisma.product.create({ data: { code: lower, title, isActive: false } });
  await audit(ctx.admin!.id, "create", "product", p.id, null, p);
  await ctx.reply(`✅ Qo'shildi: ${p.code}. Narx, kanal va videoni sozlab, /on ${p.code} bilan yoqing.`);
});

async function updateProduct(ctx: BotContext, code: string | undefined, data: Prisma.ProductUpdateInput, label: string) {
  const p = await productOrFail(ctx, code);
  if (!p) return;
  const after = await prisma.product.update({ where: { id: p.id }, data });
  await audit(ctx.admin!.id, "update", "product", p.id, p, after);
  await ctx.reply(`✅ ${p.code}: ${label} yangilandi.`);
}

// Narx o'zgarsa ochiq buyurtmalar eski narxda qoladi (BR-03) — chunki summa buyurtmaga qotirilgan
productManagers.command("setprice", async (ctx) => {
  const [code, sum] = args(ctx);
  const price = Number((sum ?? "").replace(/\D/g, ""));
  if (!price) return void (await ctx.reply("Format: /setprice <kod> <summa>, masalan /setprice 4b 1250000"));
  if (price > PRICE_MAX) return void (await ctx.reply(`Summa ${formatSum(PRICE_MAX)} dan oshmasin.`));
  await updateProduct(ctx, code, { price }, `narx ${formatSum(price)}`);
});

productManagers.command("setoldprice", async (ctx) => {
  const [code, sum] = args(ctx);
  const v = Number((sum ?? "").replace(/\D/g, ""));
  if (v > PRICE_MAX) return void (await ctx.reply(`Summa ${formatSum(PRICE_MAX)} dan oshmasin.`));
  await updateProduct(ctx, code, { oldPrice: v || null }, "eski narx");
});

productManagers.command("settitle", async (ctx) => {
  const [code] = args(ctx);
  const title = rest(ctx);
  if (!title) return void (await ctx.reply("Format: /settitle <kod> <nomi>"));
  if (title.length > TITLE_MAX) return void (await ctx.reply(`Nomi ${TITLE_MAX} belgidan oshmasin (hozir ${title.length}).`));
  await updateProduct(ctx, code, { title }, "nomi");
});

productManagers.command("setdesc", async (ctx) => {
  const [code] = args(ctx);
  const description = rest(ctx);
  if (!description) return void (await ctx.reply("Format: /setdesc <kod> <tavsif>"));
  if (description.length > DESC_MAX) return void (await ctx.reply(`Tavsif ${DESC_MAX} belgidan oshmasin (hozir ${description.length}).`));
  await updateProduct(ctx, code, { description }, "tavsif");
});

productManagers.command("setchannel", async (ctx) => {
  const [code, input] = args(ctx);
  if (!input) {
    return void (await ctx.reply("Format: /setchannel <kod> <kanal_id yoki havola>, masalan /setchannel 4b -1001234567890 yoki /setchannel 4b https://t.me/+AbCd..."));
  }
  let id: string;
  try {
    id = await resolveChannelId(ctx.api, input);
  } catch (err) {
    if (err instanceof ChannelInputError) return void (await ctx.reply(`❗️ ${err.message}`));
    throw err;
  }
  // Bot kanalda admin va "foydalanuvchilarni taklif qilish" huquqiga ega bo'lishi kerak (TZ 11.3)
  try {
    const me = await ctx.api.getMe();
    const member = await ctx.api.getChatMember(Number(id), me.id);
    const canInvite = member.status === "administrator" && member.can_invite_users;
    const canBan = member.status === "administrator" && member.can_restrict_members;
    if (!canInvite) {
      return void (await ctx.reply("❗️ Bot bu kanalda admin emas yoki «foydalanuvchilarni taklif qilish» huquqi yo'q."));
    }
    if (!canBan) await ctx.reply("⚠️ Botda «a'zolarni chiqarish» huquqi yo'q — pul qaytarishda kerak bo'ladi.");
  } catch {
    return void (await ctx.reply("❗️ Kanal topilmadi. Botni kanalga admin qilib qo'shing va ID ni tekshiring."));
  }
  await updateProduct(ctx, code, { channelId: BigInt(id) }, "kanal");
});

productManagers.command("on", async (ctx) => updateProduct(ctx, args(ctx)[0], { isActive: true }, "holati (faol)"));
productManagers.command("off", async (ctx) => updateProduct(ctx, args(ctx)[0], { isActive: false }, "holati (nofaol)"));

// Tanishtiruv videosi: super admin botga video yuboradi va mahsulotni tanlaydi
const pendingVideo = new SharedState("product_video", 30 * 60_000, z.string());

productManagers.chatType("private").on("message:video", async (ctx) => {
  await pendingVideo.set(ctx.from.id, ctx.message.video.file_id);
  const products = await prisma.product.findMany({ where: { type: "channel", deletedAt: null }, orderBy: { id: "asc" } });
  const all = await prisma.product.findMany({ where: { type: "bundle", deletedAt: null } });
  const kb = new InlineKeyboard();
  for (const p of [...products, ...all]) kb.text(p.title, `adm:vid:${p.code}`).row();
  await ctx.reply("Bu video qaysi mahsulotning tanishtiruv videosi?", { reply_markup: kb.text("Bekor qilish", "adm:vid:-") });
});

productManagers.callbackQuery(/^adm:vid:([\w-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const fileId = await pendingVideo.take(ctx.from.id);
  if (ctx.match[1] === "-" || !fileId) return void (await ctx.editMessageText("Bekor qilindi."));
  await ctx.editMessageText("Saqlanmoqda…");
  await updateProduct(ctx, ctx.match[1], { videoFileId: fileId }, "video");
});

// ---------- Kartalar ----------
cardManagers.command("cards", async (ctx) => {
  await ctx.reply(await cardsSummary(), { parse_mode: "HTML" });
});

cardManagers.command("addcard", async (ctx) => {
  const m = String(ctx.match ?? "").trim().match(/^([\d\s]{16,23})\s+(.+)$/);
  if (!m) return void (await ctx.reply("Format: /addcard 8600123412341234 Aziz Karimov"));
  try {
    const card = await addCard(m[1], m[2].trim());
    await audit(ctx.admin!.id, "create", "card", card.id, null, { masked: card.numberMasked, holder: card.holder });
    await ctx.reply(`✅ Karta qo'shildi: #${card.id} ${card.numberMasked}`);
  } catch (err) {
    await ctx.reply(`❗️ ${(err as Error).message}`);
  }
});

async function cardAction(ctx: BotContext, fn: (id: number) => Promise<void>, label: string) {
  const id = Number(args(ctx)[0]);
  if (!id) return void (await ctx.reply("Karta ID sini yozing. Ro'yxat: /cards"));
  try {
    await fn(id);
    await audit(ctx.admin!.id, label, "card", id);
    await ctx.reply(`✅ Karta #${id}: ${label}`);
  } catch {
    await ctx.reply("Karta topilmadi.");
  }
}

cardManagers.command("delcard", (ctx) => cardAction(ctx, deleteCard, "o'chirildi"));
cardManagers.command("cardon", (ctx) => cardAction(ctx, (id) => setCardActive(id, true), "navbatga qo'shildi"));
cardManagers.command("cardoff", (ctx) => cardAction(ctx, (id) => setCardActive(id, false), "navbatdan chiqarildi"));

// ---------- Adminlar ----------
adminManagers.command("admins", async (ctx) => {
  await ctx.reply(await adminsSummary(), { parse_mode: "HTML" });
});

adminManagers.command("addadmin", async (ctx) => {
  const [id, role] = args(ctx);
  if (!id || !/^\d{1,15}$/.test(id)) return void (await ctx.reply("Format: /addadmin <telegram_id> [super]"));
  const a = await addAdmin(BigInt(id), role === "super" ? "superadmin" : "admin");
  await audit(ctx.admin!.id, "add_admin", "admin", a.id, null, { telegramId: id, role: a.role });
  await ctx.reply(`✅ Admin qo'shildi: ${id} (${a.role})`);
});

adminManagers.command("deladmin", async (ctx) => {
  const [id] = args(ctx);
  if (!id || !/^\d{1,15}$/.test(id)) return void (await ctx.reply("Format: /deladmin <telegram_id>"));
  const ok = await removeAdmin(BigInt(id));
  if (ok) await audit(ctx.admin!.id, "remove_admin", "admin", id);
  await ctx.reply(ok ? `✅ O'chirildi: ${id}` : "Topilmadi yoki .env dagi super adminni o'chirib bo'lmaydi.");
});

/** Oxirgi buyurtmalar (tekshiruv uchun qisqa ko'rinish) */
admins.command("order", async (ctx) => {
  const id = args(ctx)[0];
  if (!id || !/^\d{1,18}$/.test(id)) return void (await ctx.reply("Format: /order <raqam>"));
  const o = await prisma.order.findUnique({ where: { id: BigInt(id) }, include: { user: true, product: true } });
  if (!o) return void (await ctx.reply("Buyurtma topilmadi."));
  await ctx.reply(
    `#${o.id} ${escapeHtml(o.product.title)} — ${o.status}\n${escapeHtml(displayName(o.user))} · ${formatSum(o.amount)}\nOchilgan: ${formatShortDateTime(o.createdAt)}`,
    { parse_mode: "HTML" },
  );
  if (o.status === "receipt_sent") await postReceiptCard(ctx.api, ctx.chat!.id, o.id);
});
