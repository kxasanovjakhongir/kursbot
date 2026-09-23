import { Composer, InlineKeyboard } from "grammy";
import type { BotContext } from "../context";
import { postReceiptCard } from "./receiptCard";
import { escapeHtml, formatShortDateTime, formatSum } from "../../lib/format";
import { prisma } from "../../db";
import { pendingReceiptOrders } from "../../services/orders";
import { addCard, deleteCard, listCards, setCardActive } from "../../services/cards";
import { addAdmin, isSuper, listAdmins, removeAdmin } from "../../services/admins";
import { audit } from "../../services/events";
import { setSetting } from "../../services/settings";
import { displayName } from "../../services/users";

export const adminCommands = new Composer<BotContext>();
const admins = adminCommands.filter((ctx) => !!ctx.admin);
const supers = adminCommands.filter((ctx) => isSuper(ctx.admin));

const HELP = `<b>Admin panel</b>

<b>Cheklar</b>
/pending — kutilayotgan cheklar (eng eskisi birinchi)

<b>Mahsulotlar</b> (super admin)
/products — ro'yxat va sozlamalar
/addproduct &lt;kod&gt; &lt;nomi&gt;
/setprice &lt;kod&gt; &lt;summa&gt;
/setoldprice &lt;kod&gt; &lt;summa|0&gt;
/settitle &lt;kod&gt; &lt;nomi&gt;
/setdesc &lt;kod&gt; &lt;tavsif&gt;
/setchannel &lt;kod&gt; &lt;kanal_id&gt;
/on &lt;kod&gt;, /off &lt;kod&gt; — faol/nofaol
Video: botga videoni yuboring va mahsulotni tanlang

<b>Kartalar</b> (super admin)
/cards, /addcard &lt;16 raqam&gt; &lt;egasi&gt;
/delcard &lt;id&gt;, /cardon &lt;id&gt;, /cardoff &lt;id&gt;

<b>Adminlar</b> (super admin)
/admins, /addadmin &lt;telegram_id&gt; [super], /deladmin &lt;telegram_id&gt;
/setgroup — admin guruhida yozing (cheklar shu guruhga keladi)`;

admins.command("admin", async (ctx) => {
  const pending = await prisma.order.count({ where: { status: "receipt_sent" } });
  await ctx.reply(HELP, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text(`🧾 Kutilayotgan cheklar (${pending})`, "adm:pending"),
  });
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
supers.command("setgroup", async (ctx) => {
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

async function productOrFail(ctx: BotContext, code: string | undefined) {
  const p = code ? await prisma.product.findUnique({ where: { code: code.toLowerCase() } }) : null;
  if (!p) await ctx.reply("Mahsulot topilmadi. Kodlar: /products");
  return p;
}

supers.command("products", async (ctx) => {
  const products = await prisma.product.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  if (products.length === 0) return void (await ctx.reply("Mahsulotlar yo'q. /addproduct bilan qo'shing."));
  const me = await ctx.api.getMe();
  const lines = products.map((p) =>
    [
      `<b>${escapeHtml(p.title)}</b> — <code>${p.code}</code> ${p.isActive ? "🟢" : "⚪️ nofaol"}`,
      `Narx: ${p.price > 0 ? formatSum(p.price) : "❗️ kiritilmagan"}${p.oldPrice ? ` (eski: ${formatSum(p.oldPrice)})` : ""}`,
      p.type === "bundle" ? `To'plam: ${p.bundleCodes.join(" + ")}` : `Kanal: ${p.channelId ? `<code>${p.channelId}</code>` : "❗️ kiritilmagan"}`,
      `Video: ${p.videoFileId ? "✅" : "—"}`,
      `Link: <code>https://t.me/${me.username}?start=${p.code}_bio</code>`,
    ].join("\n"),
  );
  await ctx.reply(lines.join("\n\n"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
});

supers.command("addproduct", async (ctx) => {
  const [code] = args(ctx);
  const title = rest(ctx);
  if (!code || !title || !/^[a-z0-9]+$/i.test(code)) {
    return void (await ctx.reply("Format: /addproduct <kod> <nomi>  (kod faqat harf va raqam, masalan 4b)"));
  }
  const p = await prisma.product.create({ data: { code: code.toLowerCase(), title, isActive: false } });
  await audit(ctx.admin!.id, "create", "product", p.id, null, p);
  await ctx.reply(`✅ Qo'shildi: ${p.code}. Narx, kanal va videoni sozlab, /on ${p.code} bilan yoqing.`);
});

async function updateProduct(ctx: BotContext, code: string | undefined, data: Record<string, unknown>, label: string) {
  const p = await productOrFail(ctx, code);
  if (!p) return;
  const after = await prisma.product.update({ where: { id: p.id }, data });
  await audit(ctx.admin!.id, "update", "product", p.id, p, after);
  await ctx.reply(`✅ ${p.code}: ${label} yangilandi.`);
}

// Narx o'zgarsa ochiq buyurtmalar eski narxda qoladi (BR-03) — chunki summa buyurtmaga qotirilgan
supers.command("setprice", async (ctx) => {
  const [code, sum] = args(ctx);
  const price = Number((sum ?? "").replace(/\D/g, ""));
  if (!price) return void (await ctx.reply("Format: /setprice <kod> <summa>, masalan /setprice 4b 1250000"));
  await updateProduct(ctx, code, { price }, `narx ${formatSum(price)}`);
});

supers.command("setoldprice", async (ctx) => {
  const [code, sum] = args(ctx);
  const v = Number((sum ?? "").replace(/\D/g, ""));
  await updateProduct(ctx, code, { oldPrice: v || null }, "eski narx");
});

supers.command("settitle", async (ctx) => {
  const [code] = args(ctx);
  const title = rest(ctx);
  if (!title) return void (await ctx.reply("Format: /settitle <kod> <nomi>"));
  await updateProduct(ctx, code, { title }, "nomi");
});

supers.command("setdesc", async (ctx) => {
  const [code] = args(ctx);
  const description = rest(ctx);
  if (!description) return void (await ctx.reply("Format: /setdesc <kod> <tavsif>"));
  await updateProduct(ctx, code, { description }, "tavsif");
});

supers.command("setchannel", async (ctx) => {
  const [code, id] = args(ctx);
  if (!id || !/^-100\d+$/.test(id)) {
    return void (await ctx.reply("Format: /setchannel <kod> <kanal_id>, masalan /setchannel 4b -1001234567890"));
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

supers.command("on", async (ctx) => updateProduct(ctx, args(ctx)[0], { isActive: true }, "holati (faol)"));
supers.command("off", async (ctx) => updateProduct(ctx, args(ctx)[0], { isActive: false }, "holati (nofaol)"));

// Tanishtiruv videosi: super admin botga video yuboradi va mahsulotni tanlaydi
const pendingVideo = new Map<number, string>();

supers.chatType("private").on("message:video", async (ctx) => {
  pendingVideo.set(ctx.from.id, ctx.message.video.file_id);
  const products = await prisma.product.findMany({ where: { type: "channel" }, orderBy: { id: "asc" } });
  const all = await prisma.product.findMany({ where: { type: "bundle" } });
  const kb = new InlineKeyboard();
  for (const p of [...products, ...all]) kb.text(p.title, `adm:vid:${p.code}`).row();
  await ctx.reply("Bu video qaysi mahsulotning tanishtiruv videosi?", { reply_markup: kb.text("Bekor qilish", "adm:vid:-") });
});

supers.callbackQuery(/^adm:vid:([\w-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const fileId = pendingVideo.get(ctx.from.id);
  pendingVideo.delete(ctx.from.id);
  if (ctx.match[1] === "-" || !fileId) return void (await ctx.editMessageText("Bekor qilindi."));
  await ctx.editMessageText("Saqlanmoqda…");
  await updateProduct(ctx, ctx.match[1], { videoFileId: fileId }, "video");
});

// ---------- Kartalar ----------
supers.command("cards", async (ctx) => {
  const cards = await listCards();
  if (cards.length === 0) return void (await ctx.reply("Kartalar yo'q. /addcard bilan qo'shing."));
  const stats = await prisma.order.groupBy({
    by: ["cardId"],
    where: { status: { in: ["approved", "joined"] }, paidAt: { gte: new Date(Date.now() - 30 * 86400_000) } },
    _sum: { amount: true },
  });
  const lines = cards.map((c) => {
    const sum = stats.find((s) => s.cardId === c.id)?._sum.amount ?? 0;
    return `#${c.id} ${c.numberMasked} — ${escapeHtml(c.holder)} ${c.isActive ? "🟢" : "⚪️"}\n30 kun tushum: ${formatSum(sum)}`;
  });
  await ctx.reply(lines.join("\n\n"), { parse_mode: "HTML" });
});

supers.command("addcard", async (ctx) => {
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

supers.command("delcard", (ctx) => cardAction(ctx, deleteCard, "o'chirildi"));
supers.command("cardon", (ctx) => cardAction(ctx, (id) => setCardActive(id, true), "navbatga qo'shildi"));
supers.command("cardoff", (ctx) => cardAction(ctx, (id) => setCardActive(id, false), "navbatdan chiqarildi"));

// ---------- Adminlar ----------
supers.command("admins", async (ctx) => {
  const list = await listAdmins();
  await ctx.reply(
    list.map((a) => `${a.role === "superadmin" ? "⭐️" : "👤"} <code>${a.telegramId}</code> ${escapeHtml(a.name ?? "")}`).join("\n"),
    { parse_mode: "HTML" },
  );
});

supers.command("addadmin", async (ctx) => {
  const [id, role] = args(ctx);
  if (!id || !/^\d+$/.test(id)) return void (await ctx.reply("Format: /addadmin <telegram_id> [super]"));
  const a = await addAdmin(BigInt(id), role === "super" ? "superadmin" : "admin");
  await audit(ctx.admin!.id, "add_admin", "admin", a.id, null, { telegramId: id, role: a.role });
  await ctx.reply(`✅ Admin qo'shildi: ${id} (${a.role})`);
});

supers.command("deladmin", async (ctx) => {
  const [id] = args(ctx);
  if (!id || !/^\d+$/.test(id)) return void (await ctx.reply("Format: /deladmin <telegram_id>"));
  const ok = await removeAdmin(BigInt(id));
  if (ok) await audit(ctx.admin!.id, "remove_admin", "admin", id);
  await ctx.reply(ok ? `✅ O'chirildi: ${id}` : "Topilmadi yoki .env dagi super adminni o'chirib bo'lmaydi.");
});

/** Oxirgi buyurtmalar (tekshiruv uchun qisqa ko'rinish) */
admins.command("order", async (ctx) => {
  const id = args(ctx)[0];
  if (!id || !/^\d+$/.test(id)) return void (await ctx.reply("Format: /order <raqam>"));
  const o = await prisma.order.findUnique({ where: { id: BigInt(id) }, include: { user: true, product: true } });
  if (!o) return void (await ctx.reply("Buyurtma topilmadi."));
  await ctx.reply(
    `#${o.id} ${escapeHtml(o.product.title)} — ${o.status}\n${escapeHtml(displayName(o.user))} · ${formatSum(o.amount)}\nOchilgan: ${formatShortDateTime(o.createdAt)}`,
    { parse_mode: "HTML" },
  );
  if (o.status === "receipt_sent") await postReceiptCard(ctx.api, ctx.chat!.id, o.id);
});
