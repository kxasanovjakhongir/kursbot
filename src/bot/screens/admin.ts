import { InlineKeyboard } from "grammy";
import type { BotContext } from "../context";
import { withNav } from "../keyboards";
import { ADMIN_HELP, cardsSummary, productsSummary } from "../admin/summaries";
import { formatDateTime, formatSum } from "../../lib/format";
import { prisma } from "../../db";
import { can, type Role } from "../../services/permissions";
import { getDashboardStats } from "../../services/stats";
import type { TextKey } from "../../i18n";
import { CB } from "../ui/callbacks";
import type { Screen } from "../ui/render";

const ROLE_KEY: Record<Role, TextKey> = { user: "role_user", admin: "role_admin", superadmin: "role_superadmin" };

/** Admin panel guruhda ham ochiladi — u yerda "🏠 Bosh menyu" (mijoz menyusi) bo'lmaydi, faqat "Orqaga" */
function adminNav(ctx: BotContext, kb: InlineKeyboard, back?: string): InlineKeyboard {
  if (ctx.chat?.type === "private") return withNav(kb, ctx.lang, back);
  return back ? kb.row().text(ctx.label("btn_back"), back) : kb;
}

/** 🛠 Admin panel (bot ichida): faqat rolga ruxsat berilgan bo'limlar ko'rinadi */
export async function adminHomeScreen(ctx: BotContext): Promise<Screen> {
  const pending = await prisma.order.count({ where: { status: "receipt_sent" } });
  const kb = new InlineKeyboard()
    .text(ctx.label("adm_btn_stats"), CB.adminStats)
    .text(ctx.label("adm_btn_pending", { soni: pending }), CB.adminPending)
    .row();
  if (can(ctx.role, "products.manage")) kb.text(ctx.label("adm_btn_products"), CB.adminProducts);
  if (can(ctx.role, "cards.manage")) kb.text(ctx.label("adm_btn_cards"), CB.adminCards);
  kb.row();
  if (can(ctx.role, "lessons.manage")) kb.text("🎥 Darslar", CB.adminLessons);
  if (can(ctx.role, "users.export")) kb.text("📤 Export", CB.adminExport);
  kb.row();
  if (can(ctx.role, "admins.manage")) kb.text(ctx.label("adm_btn_admins"), CB.adminAdmins);
  kb.text(ctx.label("adm_btn_commands"), CB.adminHelp);
  const text = await ctx.t("adm_title", { rol: await ctx.t(ROLE_KEY[ctx.role]), cheklar: pending });
  return { text, keyboard: adminNav(ctx, kb) };
}

export async function adminStatsScreen(ctx: BotContext): Promise<Screen> {
  const s = await getDashboardStats();
  const text = await ctx.t("adm_stats", {
    jami: s.users.total,
    bugun: s.users.newToday,
    hafta: s.users.newWeek,
    faol: s.users.active30d,
    bloklagan: s.users.blocked,
    buyurtmalar: s.sales.ordersToday,
    cheklar: s.sales.pendingReceipts,
    tushum_bugun: formatSum(s.sales.revenueToday),
    tushum_oy: formatSum(s.sales.revenueMonth),
    vaqt: formatDateTime(new Date()),
  });
  const kb = new InlineKeyboard().text(ctx.label("adm_btn_refresh"), CB.adminStats);
  return { text, keyboard: adminNav(ctx, kb, CB.admin) };
}

/** Matnli admin bo'limlari (mahsulotlar, kartalar, adminlar, buyruqlar) — umumiy ko'rinish */
async function textSection(ctx: BotContext, text: string): Promise<Screen> {
  return { text, keyboard: adminNav(ctx, new InlineKeyboard(), CB.admin) };
}

export const adminProductsScreen = async (ctx: BotContext) => textSection(ctx, await productsSummary(ctx.api));
export const adminCardsScreen = async (ctx: BotContext) => textSection(ctx, await cardsSummary());
export const adminHelpScreen = async (ctx: BotContext) => textSection(ctx, ADMIN_HELP);
