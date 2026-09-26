import { Composer, InlineKeyboard } from "grammy";
import type { BotContext } from "../context";
import { approveAndNotify, rejectAndNotify, syncCards, type CardRef } from "./reviewActions";
import { audit } from "../../services/events";
import { isRejectReason, REJECT_REASONS, type RejectReasonCode } from "../../services/texts";
import { prisma } from "../../db";
import { z } from "zod";
import { SharedState } from "../../services/sharedState";
import { can } from "../../services/permissions";

/** Telegram admin guruhidagi chek tugmalari */
export const review = new Composer<BotContext>();

function clickedRef(ctx: BotContext): CardRef | undefined {
  const m = ctx.callbackQuery?.message;
  if (!m) return undefined;
  return { chatId: m.chat.id, messageId: m.message_id, isMedia: !!(m.photo || m.document) };
}

// Admin tugmalari har safar ID bo'yicha qayta tekshiriladi (TZ 11.5)
review.callbackQuery(/^adm:/, async (ctx, next) => {
  if (!can(ctx.role, "orders.review")) {
    await ctx.answerCallbackQuery({ text: "Ruxsat yo'q", show_alert: true });
    return;
  }
  await next();
});

// ---------- Tasdiqlash ----------
review.callbackQuery(/^adm:ap:(\d{1,18})$/, async (ctx) => {
  const orderId = BigInt(ctx.match[1]);
  const admin = ctx.admin!;
  const ok = await approveAndNotify(ctx.api, orderId, { adminId: admin.id }, clickedRef(ctx));
  if (!ok) {
    // BR-12: ikkinchi admin
    await ctx.answerCallbackQuery({ text: "Bu chek allaqachon ko'rib chiqilgan", show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery({ text: "Tasdiqlandi ✅" });
  await audit(admin.id, "approve", "order", orderId, { status: "receipt_sent" }, { status: "approved" });
});

// ---------- Rad etish ----------
function reasonsKeyboard(orderId: bigint): InlineKeyboard {
  const kb = new InlineKeyboard();
  (Object.keys(REJECT_REASONS) as RejectReasonCode[]).forEach((code, i) => {
    kb.text(REJECT_REASONS[code].label, `adm:rr:${orderId}:${code}`);
    if (i % 2 === 1) kb.row();
  });
  return kb.row().text("⬅️ Orqaga", `adm:bk:${orderId}`);
}

review.callbackQuery(/^adm:rj:(\d{1,18})$/, async (ctx) => {
  const orderId = BigInt(ctx.match[1]);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (order?.status !== "receipt_sent") {
    await ctx.answerCallbackQuery({ text: "Bu chek allaqachon ko'rib chiqilgan", show_alert: true });
    await syncCards(ctx.api, orderId, clickedRef(ctx));
    return;
  }
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: reasonsKeyboard(orderId) });
});

review.callbackQuery(/^adm:bk:(\d{1,18})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await syncCards(ctx.api, BigInt(ctx.match[1]), clickedRef(ctx));
});

/** "Summa kam" va "Boshqa" uchun admin qo'shimcha ma'lumot yozadi */
const INPUT_TTL = 15 * 60_000;
const pendingInput = new SharedState(
  "reject_input",
  INPUT_TTL,
  z.object({
    orderId: z.coerce.bigint(),
    code: z.string().refine(isRejectReason),
    card: z.object({ chatId: z.number(), messageId: z.number(), isMedia: z.boolean() }).optional(),
  }),
);

async function reject(ctx: BotContext, orderId: bigint, code: RejectReasonCode, extra: string | null, card?: CardRef) {
  const admin = ctx.admin!;
  const res = await rejectAndNotify(ctx.api, orderId, code, extra, { adminId: admin.id }, card);
  if (res.ok) await audit(admin.id, "reject", "order", orderId, { status: "receipt_sent" }, { status: "rejected", reason: res.stored });
  return res.ok;
}

review.callbackQuery(/^adm:rr:(\d{1,18}):(\w+)$/, async (ctx) => {
  const orderId = BigInt(ctx.match[1]);
  const code = ctx.match[2];
  if (!isRejectReason(code)) return ctx.answerCallbackQuery();

  if (code === "short" || code === "other") {
    await ctx.answerCallbackQuery();
    await pendingInput.set(ctx.from.id, { orderId, code, card: clickedRef(ctx) });
    const prompt =
      code === "short"
        ? `Buyurtma #${orderId}: yetishmayotgan summani yozing (masalan, 50000).`
        : `Buyurtma #${orderId}: mijozga boradigan rad etish sababini yozing.`;
    await ctx.reply(prompt, {
      reply_markup: { force_reply: true, selective: true },
      reply_parameters: ctx.callbackQuery.message ? { message_id: ctx.callbackQuery.message.message_id } : undefined,
    });
    return;
  }
  const done = await reject(ctx, orderId, code, null, clickedRef(ctx));
  await ctx.answerCallbackQuery(done ? { text: "Rad etildi" } : { text: "Bu chek allaqachon ko'rib chiqilgan", show_alert: true });
});

review.on("message:text", async (ctx, next) => {
  if (!can(ctx.role, "orders.review") || ctx.message.text.startsWith("/")) return next();
  // Atomik: bir xil javob ikki marta qayta ishlanmaydi
  const pending = await pendingInput.take(ctx.from.id);
  if (!pending) return next();

  let extra: string;
  if (pending.code === "short") {
    const amount = Number(ctx.message.text.replace(/\D/g, ""));
    if (!amount) {
      await pendingInput.set(ctx.from.id, pending);
      await ctx.reply("Summani raqam bilan yozing, masalan: 50000");
      return;
    }
    extra = String(amount);
  } else {
    extra = ctx.message.text.trim().slice(0, 500);
  }
  const done = await reject(ctx, pending.orderId, pending.code, extra, pending.card);
  await ctx.reply(done ? `Buyurtma #${pending.orderId} rad etildi.` : "Bu chek allaqachon ko'rib chiqilgan.");
});
