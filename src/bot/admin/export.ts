import { PassThrough } from "node:stream";
import { Composer, GrammyError, InlineKeyboard, InputFile } from "grammy";
import type { BotContext } from "../context";
import { withNav } from "../keyboards";
import { CB } from "../ui/callbacks";
import { render, type Screen } from "../ui/render";
import { formatSum } from "../../lib/format";
import { TtlMap } from "../../lib/ttlMap";
import { audit } from "../../services/events";
import { exportFileName, prepareUserExport, type ExportFormat, type ExportPart } from "../../services/export";
import { can } from "../../services/permissions";
import type { UserFilter } from "../../services/users";

/**
 * Bot ichida foydalanuvchilar bazasini yuklab olish ("users.export"). Fayl diskka ham, xotiraga ham
 * to'liq yig'ilmaydi — generatsiya qilinishi bilan Telegram'ga oqim sifatida yuklanadi.
 * Telegram cheklovi: bot yuboradigan fayl 50 MB gacha. Fayl undan katta chiqsa, ro'yxat 2 qismga bo'linib
 * ikki fayl qilib yuboriladi; qism ham sig'masa — veb paneldan yuklab olinadi.
 */
export const adminExport = new Composer<BotContext>();
const exporters = adminExport.chatType("private").filter((ctx) => can(ctx.role, "users.export"));

const AUDIENCES = {
  a: { label: "👥 Barchasi", filter: {} },
  b: { label: "💳 Sotib olganlar", filter: { purchased: true } },
  n: { label: "🕐 Sotib olmaganlar", filter: { purchased: false } },
} as const satisfies Record<string, { label: string; filter: Partial<UserFilter> }>;
type Audience = keyof typeof AUDIENCES;

const FORMATS: { format: ExportFormat; label: string }[] = [
  { format: "xlsx", label: "📊 Excel" },
  { format: "docx", label: "📝 Word" },
  { format: "pdf", label: "📄 PDF" },
];

const SPLIT_PARTS = 2;

const isTooLarge = (err: unknown) => err instanceof GrammyError && err.error_code === 413;

/** Bitta faylni (butun ro'yxat yoki uning bir qismi) hosil qilib, oqim bilan yuboradi. Jami foydalanuvchilar soni qaytadi */
async function sendExport(ctx: BotContext, format: ExportFormat, audience: Audience, part?: ExportPart): Promise<number> {
  const { summary, write } = await prepareUserExport(format, { status: "all", ...AUDIENCES[audience].filter }, part);
  await ctx.replyWithChatAction("upload_document").catch(() => undefined);
  const stream = new PassThrough();
  const writing = write(stream).catch((err: unknown) => {
    stream.destroy(err instanceof Error ? err : new Error(String(err)));
    throw err;
  });
  const lines = [
    `📤 ${AUDIENCES[audience].label}: ${summary.total} ta foydalanuvchi`,
    ...(summary.part ? [`📑 ${summary.part.index}-qism (jami ${summary.part.of} ta): ${summary.part.from}–${summary.part.to}-qatorlar`] : []),
    `💳 Sotib olganlar: ${summary.buyers}`,
    `💰 Jami: ${formatSum(summary.revenue)}`,
  ];
  const file = new InputFile(stream, exportFileName(format, summary.generatedAt, part?.index));
  try {
    await Promise.all([ctx.replyWithDocument(file, { caption: lines.join("\n") }), writing]);
  } catch (err) {
    // Yuborilmadi (masalan, 413): o'qilmay qolgan oqim yopiladi — yozuvchi va baza kursori osilib qolmaydi
    stream.destroy();
    writing.catch(() => undefined);
    throw err;
  }
  return summary.total;
}

/** Bir admin bir vaqtda bitta export (ketma-ket bosishlar serverni band qilmaydi) */
const running = new TtlMap<number, true>(10 * 60_000);

function exportScreen(ctx: BotContext, audience: Audience): Screen {
  const kb = new InlineKeyboard();
  for (const [key, a] of Object.entries(AUDIENCES)) kb.text(`${key === audience ? "✅ " : ""}${a.label}`, `ax:s:${key}`);
  kb.row();
  for (const f of FORMATS) kb.text(f.label, `ax:f:${audience}:${f.format}`);
  return {
    text:
      "📤 <b>Foydalanuvchilarni yuklab olish</b>\n\nAuditoriyani tanlang, keyin formatni bosing.\n\n" +
      "<i>Kurs, sana oralig'i va to'lov holati bo'yicha batafsil filtr — veb admin panelning «Telegram foydalanuvchilar» bo'limida.</i>",
    keyboard: withNav(kb, ctx.lang, CB.admin),
  };
}

exporters.callbackQuery(CB.adminExport, async (ctx) => render(ctx, exportScreen(ctx, "a")));
exporters.callbackQuery(/^ax:s:([abn])$/, async (ctx) => render(ctx, exportScreen(ctx, ctx.match[1] as Audience)));

exporters.callbackQuery(/^ax:f:([abn]):(xlsx|docx|pdf)$/, async (ctx) => {
  const id = ctx.from.id;
  if (running.has(id)) {
    await ctx.answerCallbackQuery({ text: "⏳ Oldingi fayl hali tayyorlanmoqda", show_alert: true });
    return;
  }
  const audience = ctx.match[1] as Audience;
  const format = ctx.match[2] as ExportFormat;
  running.set(id, true);
  try {
    await ctx.answerCallbackQuery({ text: "⏳ Fayl tayyorlanmoqda..." });
    let total: number;
    let parts = 1;
    try {
      total = await sendExport(ctx, format, audience);
    } catch (err) {
      if (!isTooLarge(err)) throw err;
      // Fayl 50 MB dan katta — ro'yxat teng ikkiga bo'linib, ikki fayl qilib yuboriladi
      parts = SPLIT_PARTS;
      await ctx.reply(`⚠️ Fayl Telegram limiti (50 MB) dan katta — ${parts} qismga bo'lib yuborilmoqda...`);
      total = 0;
      for (let index = 1; index <= parts; index++) total = await sendExport(ctx, format, audience, { index, of: parts });
    }
    await audit(ctx.admin?.id ?? null, "export_users", "user", null, null, { format, audience, total, parts });
  } catch (err) {
    if (isTooLarge(err)) {
      await ctx.reply("⚠️ Fayl ikkiga bo'linganda ham Telegram limiti (50 MB) dan katta. Uni veb admin paneldan yuklab oling.");
      return;
    }
    ctx.log.error({ err, format, audience }, "export (bot) xatosi");
    await ctx.reply("❌ Faylni tayyorlashda xatolik. Birozdan keyin qayta urinib ko'ring.");
  } finally {
    running.delete(id);
  }
});

adminExport.callbackQuery([CB.adminExport, /^ax:/], async (ctx) => {
  await ctx.answerCallbackQuery({ text: await ctx.t("adm_no_permission"), show_alert: true });
});
