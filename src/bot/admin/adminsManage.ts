import { Composer, InlineKeyboard, Keyboard, type Api } from "grammy";
import type { AdminRole } from "@prisma/client";
import { z } from "zod";
import type { BotContext } from "../context";
import { mainMenu, withNav } from "../keyboards";
import { CB } from "../ui/callbacks";
import { render, type Screen } from "../ui/render";
import { prisma } from "../../db";
import { config } from "../../config";
import { escapeHtml, formatDate } from "../../lib/format";
import { logger } from "../../lib/logger";
import { AdminChangeError, grantAdmin, listAdmins, revokeAdmin, setAdminRole } from "../../services/admins";
import { audit } from "../../services/events";
import { can } from "../../services/permissions";
import { SharedState } from "../../services/sharedState";

/**
 * Bot ichida adminlarni boshqarish (faqat SUPER_ADMIN, "admins.manage"):
 * ro'yxat → admin kartasi (rolni almashtirish, o'chirish) va Telegram ID orqali yangi admin qo'shish.
 * Qo'shishda ID ni qo'lda yozish, "Foydalanuvchini tanlash" (Telegram oynasi) yoki kontakt yuborish mumkin.
 */
export const adminsManage = new Composer<BotContext>();
const managers = adminsManage.filter((ctx) => can(ctx.role, "admins.manage"));

const ADD_REQUEST_ID = 7101;
const ID_RE = /^\d{5,15}$/;
const ROLE_LABEL: Record<AdminRole, string> = { superadmin: "⭐️ Super admin", admin: "👤 Admin" };

/** "Admin qo'shish" bosilgan — keyingi xabar (ID, tanlangan foydalanuvchi yoki kontakt) kutiladi */
const pendingAdd = new SharedState("admin_add", 10 * 60_000, z.literal(true));

const CBA = {
  list: "adm:ad:list",
  add: "adm:ad:add",
  view: (id: bigint) => `adm:ad:v:${id}`,
  role: (id: bigint, role: AdminRole) => `adm:ad:r:${id}:${role === "superadmin" ? "s" : "a"}`,
  del: (id: bigint) => `adm:ad:d:${id}`,
  delOk: (id: bigint) => `adm:ad:dok:${id}`,
  create: (id: bigint, role: AdminRole) => `adm:ad:n:${id}:${role === "superadmin" ? "s" : "a"}`,
};
const roleOf = (c: string): AdminRole => (c === "s" ? "superadmin" : "admin");

/** Telegram ID bo'yicha bot foydalanuvchisi (ismi, username) — bo'lsa */
async function profiles(ids: bigint[]) {
  const users = await prisma.user.findMany({ where: { telegramId: { in: ids } }, select: { telegramId: true, firstName: true, lastName: true, username: true } });
  return new Map(users.map((u) => [u.telegramId, u]));
}

function displayOf(id: bigint, name: string | null, profile?: { firstName: string | null; lastName: string | null; username: string | null }): string {
  const full = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || name || "";
  return full || (profile?.username ? `@${profile.username}` : String(id));
}

export async function adminsListScreen(ctx: BotContext): Promise<Screen> {
  const list = await listAdmins();
  const people = await profiles(list.map((a) => a.telegramId));
  const kb = new InlineKeyboard();
  for (const a of list) {
    const star = a.role === "superadmin" ? "⭐️" : "👤";
    const me = a.telegramId === BigInt(ctx.from!.id) ? " (siz)" : "";
    kb.text(`${star} ${displayOf(a.telegramId, a.name, people.get(a.telegramId))}${me}`, CBA.view(a.telegramId)).row();
  }
  kb.text("➕ Admin qo'shish", CBA.add).row();
  const text =
    `👥 <b>Adminlar</b> (${list.length})\n\n` +
    "⭐️ <b>Super admin</b> — hammasini boshqaradi (mahsulotlar, kartalar, adminlar, sozlamalar)\n" +
    "👤 <b>Admin</b> — cheklarni tekshiradi, statistika va foydalanuvchilarni ko'radi\n\n" +
    "O'zgartirish uchun adminni tanlang.";
  return { text, keyboard: withNav(kb, ctx.lang, CB.admin) };
}

async function adminViewScreen(ctx: BotContext, telegramId: bigint): Promise<Screen | null> {
  const admin = await prisma.admin.findUnique({ where: { telegramId } });
  if (!admin?.isActive) return null;
  const [profile, panel] = await Promise.all([
    profiles([telegramId]).then((m) => m.get(telegramId)),
    prisma.panelUser.findUnique({ where: { telegramId }, select: { email: true, isActive: true } }),
  ]);
  const fromEnv = config.SUPERADMIN_IDS.includes(telegramId);
  const self = telegramId === BigInt(ctx.from!.id);

  const lines = [
    `${ROLE_LABEL[admin.role]}: <b>${escapeHtml(displayOf(telegramId, admin.name, profile))}</b>`,
    profile?.username ? `@${escapeHtml(profile.username)}` : null,
    `ID: <code>${telegramId}</code>`,
    `Qo'shilgan: ${formatDate(admin.createdAt)}`,
    panel ? `🖥 Veb panel: ${escapeHtml(panel.email)}${panel.isActive ? "" : " (bloklangan)"} — rol panel bilan sinxron` : null,
    profile ? null : "\n<i>Bu odam hali botga /start bosmagan — admin menyusi u botni ochganda chiqadi.</i>",
    fromEnv ? "\n🔒 .env dagi (SUPERADMIN_IDS) super admin — botdan o'zgartirilmaydi." : null,
    self && !fromEnv ? "\nBu — siz. O'z rolingizni o'zgartira olmaysiz." : null,
  ].filter((l): l is string => l !== null);

  const kb = new InlineKeyboard();
  if (!fromEnv && !self) {
    const other: AdminRole = admin.role === "superadmin" ? "admin" : "superadmin";
    kb.text(other === "superadmin" ? "⭐️ Super admin qilish" : "👤 Oddiy admin qilish", CBA.role(telegramId, other)).row();
    kb.text("🗑 Adminlikdan olish", CBA.del(telegramId)).row();
  }
  return { text: lines.join("\n"), keyboard: withNav(kb, ctx.lang, CBA.list) };
}

async function showView(ctx: BotContext, telegramId: bigint): Promise<void> {
  const screen = await adminViewScreen(ctx, telegramId);
  if (!screen) {
    await ctx.answerCallbackQuery({ text: "Bu odam endi admin emas", show_alert: true }).catch(() => undefined);
    return render(ctx, await adminsListScreen(ctx));
  }
  await render(ctx, screen);
}

/** Yangi yoki roli o'zgargan adminga xabar (botni bloklagan yoki hali ochmagan bo'lsa — jim). Panel ham ishlatadi */
export async function notifyAdminGranted(api: Api, telegramId: bigint, role: AdminRole): Promise<void> {
  const text =
    role === "superadmin"
      ? "⭐️ Sizga botda <b>super admin</b> huquqi berildi. Boshqaruv: /admin"
      : "👤 Sizga botda <b>admin</b> huquqi berildi: cheklarni tekshirish, statistika. Boshqaruv: /admin";
  await api.sendMessage(Number(telegramId), text, { parse_mode: "HTML" }).catch((err) => logger.info({ err, telegramId: String(telegramId) }, "yangi adminga xabar yetmadi"));
}

const notifyAdmin = (ctx: BotContext, telegramId: bigint, role: AdminRole) => notifyAdminGranted(ctx.api, telegramId, role);

async function failed(ctx: BotContext, err: unknown): Promise<void> {
  if (!(err instanceof AdminChangeError)) throw err;
  await ctx.answerCallbackQuery({ text: err.message, show_alert: true });
}

// ---------- Ro'yxat va karta ----------

managers.callbackQuery(CBA.list, async (ctx) => render(ctx, await adminsListScreen(ctx)));

managers.callbackQuery(/^adm:ad:v:(\d{1,15})$/, async (ctx) => showView(ctx, BigInt(ctx.match[1])));

managers.callbackQuery(/^adm:ad:r:(\d{1,15}):([as])$/, async (ctx) => {
  const id = BigInt(ctx.match[1]);
  const role = roleOf(ctx.match[2]);
  try {
    const before = await prisma.admin.findUnique({ where: { telegramId: id } });
    await setAdminRole(BigInt(ctx.from.id), id, role);
    await audit(ctx.admin!.id, "change_admin_role", "admin", before?.id ?? id, { role: before?.role }, { role, via: "bot" });
  } catch (err) {
    return failed(ctx, err);
  }
  await ctx.answerCallbackQuery({ text: `Rol o'zgardi: ${ROLE_LABEL[role]}` });
  await notifyAdmin(ctx, id, role);
  await showView(ctx, id);
});

managers.callbackQuery(/^adm:ad:d:(\d{1,15})$/, async (ctx) => {
  const id = BigInt(ctx.match[1]);
  const admin = await prisma.admin.findUnique({ where: { telegramId: id } });
  if (!admin?.isActive) return showView(ctx, id);
  const name = displayOf(id, admin.name, (await profiles([id])).get(id));
  await render(ctx, {
    text: `❗️ <b>${escapeHtml(name)}</b> (<code>${id}</code>) adminlikdan olinsinmi?\n\nU admin menyusi va buyruqlaridan foydalana olmaydi. Keyin qayta qo'shish mumkin.`,
    keyboard: new InlineKeyboard().text("🗑 Ha, olish", CBA.delOk(id)).text("Bekor qilish", CBA.view(id)),
  });
});

managers.callbackQuery(/^adm:ad:dok:(\d{1,15})$/, async (ctx) => {
  const id = BigInt(ctx.match[1]);
  try {
    await revokeAdmin(BigInt(ctx.from.id), id);
    await audit(ctx.admin!.id, "remove_admin", "admin", id, null, { via: "bot" });
  } catch (err) {
    return failed(ctx, err);
  }
  await ctx.answerCallbackQuery({ text: "Adminlikdan olindi" });
  await render(ctx, await adminsListScreen(ctx));
});

// ---------- Qo'shish: ID → rol ----------

managers.callbackQuery(CBA.add, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.chat?.type !== "private") {
    await ctx.reply("Admin qo'shish uchun botning shaxsiy chatida /admin → Adminlar bo'limini oching.");
    return;
  }
  await pendingAdd.set(ctx.from.id, true);
  await ctx.reply(
    "➕ <b>Yangi admin</b>\n\nYangi adminning <b>Telegram ID</b> sini yuboring (faqat raqamlar),\nyoki pastdagi «👤 Foydalanuvchini tanlash» tugmasi orqali uni kontaktlaringizdan tanlang.\n\n" +
      "<i>ID ni bilish: o'sha odam @userinfobot ga yozsa, ID sini ko'rsatadi.</i>",
    {
      parse_mode: "HTML",
      reply_markup: new Keyboard()
        .requestUsers("👤 Foydalanuvchini tanlash", ADD_REQUEST_ID, { user_is_bot: false, max_quantity: 1 })
        .row()
        .text("❌ Bekor qilish")
        .resized()
        .oneTime(),
    },
  );
});

/** ID qabul qilindi — rol tanlash */
async function askRole(ctx: BotContext, id: bigint): Promise<void> {
  const existing = await prisma.admin.findUnique({ where: { telegramId: id } });
  const profile = (await profiles([id])).get(id);
  const who = profile ? `<b>${escapeHtml(displayOf(id, null, profile))}</b> (<code>${id}</code>)` : `<code>${id}</code> <i>(hali botga kirmagan)</i>`;
  // Reply-klaviatura (tanlash tugmasi) o'rniga odatdagi menyu qaytadi
  await ctx.reply("✅ ID qabul qilindi", { reply_markup: mainMenu(ctx.lang, ctx.role) });
  await ctx.reply(
    existing?.isActive ? `${who} allaqachon ${ROLE_LABEL[existing.role]}. Rolni o'zgartirasizmi?` : `${who} ga qaysi huquqni beramiz?`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text(ROLE_LABEL.admin, CBA.create(id, "admin"))
        .text(ROLE_LABEL.superadmin, CBA.create(id, "superadmin"))
        .row()
        .text("Bekor qilish", CBA.list),
    },
  );
}

const pm = managers.chatType("private");

pm.on("message:users_shared", async (ctx, next) => {
  if (ctx.message.users_shared.request_id !== ADD_REQUEST_ID || !(await pendingAdd.take(ctx.from.id))) return next();
  const user = ctx.message.users_shared.users[0];
  if (!user) return;
  await askRole(ctx, BigInt(user.user_id));
});

// Kontakt: faqat Telegram hisobi bor kontaktda user_id bo'ladi
pm.on("message:contact", async (ctx, next) => {
  if (!(await pendingAdd.get(ctx.from.id))) return next();
  const userId = ctx.message.contact.user_id;
  if (!userId) return void (await ctx.reply("Bu kontaktning Telegram hisobi topilmadi. ID ni yuboring yoki «Foydalanuvchini tanlash» tugmasini bosing."));
  await pendingAdd.delete(ctx.from.id);
  await askRole(ctx, BigInt(userId));
});

pm.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/") || !(await pendingAdd.get(ctx.from.id))) return next();
  if (text === "❌ Bekor qilish") {
    await pendingAdd.delete(ctx.from.id);
    await ctx.reply("Bekor qilindi.", { reply_markup: mainMenu(ctx.lang, ctx.role) });
    return;
  }
  if (!ID_RE.test(text)) {
    await ctx.reply("Telegram ID faqat raqamlardan iborat (5–15 ta), masalan: 123456789. Qayta yuboring yoki «❌ Bekor qilish».");
    return;
  }
  // Atomik: bir xil ID ikki marta qayta ishlanmaydi
  if (!(await pendingAdd.take(ctx.from.id))) return next();
  await askRole(ctx, BigInt(text));
});

managers.callbackQuery(/^adm:ad:n:(\d{1,15}):([as])$/, async (ctx) => {
  const id = BigInt(ctx.match[1]);
  const role = roleOf(ctx.match[2]);
  if (id === BigInt(ctx.me.id)) return void (await ctx.answerCallbackQuery({ text: "Botning o'zini admin qilib bo'lmaydi", show_alert: true }));
  const profile = (await profiles([id])).get(id);
  let created: boolean;
  try {
    const res = await grantAdmin(BigInt(ctx.from.id), id, role, profile?.firstName ?? null);
    created = res.created;
    await audit(ctx.admin!.id, created ? "add_admin" : "change_admin_role", "admin", res.admin.id, null, { telegramId: String(id), role, via: "bot" });
  } catch (err) {
    return failed(ctx, err);
  }
  await ctx.answerCallbackQuery({ text: created ? "Admin qo'shildi ✅" : "Rol saqlandi" });
  await notifyAdmin(ctx, id, role);
  await showView(ctx, id);
});
