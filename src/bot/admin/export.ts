import { PassThrough } from "node:stream";
import { Composer, GrammyError, InlineKeyboard, InputFile } from "grammy";
import type { BotContext } from "../context";
import { withNav } from "../keyboards";
import { CB } from "../ui/callbacks";
import { render, type Screen } from "../ui/render";
import { formatSum } from "../../lib/format";
import { TtlMap } from "../../lib/ttlMap";
import { audit } from "../../services/events";
import { exportFileName, prepareUserExport, type ExportFormat } from "../../services/export";
import { can } from "../../services/permissions";
import type { UserFilter } from "../../services/users";

/**
 * Bot ichida foydalanuvchilar bazasini yuklab olish ("users.export"). Fayl diskka ham, xotiraga ham
 * to'liq yig'ilmaydi — generatsiya qilinishi bilan Telegram'ga oqim sifatida yuklanadi.
 * Telegram cheklovi: bot yuboradigan fayl 50 MB gacha (undan katta bo'lsa — veb paneldan yuklab olinadi).
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
    const { summary, write } = await prepareUserExport(format, { status: "all", ...AUDIENCES[audience].filter });
    await ctx.replyWithChatAction("upload_document").catch(() => undefined);
    const stream = new PassThrough();
    const writing = write(stream).catch((err: unknown) => {
      stream.destroy(err instanceof Error ? err : new Error(String(err)));
      throw err;
    });
    const caption = `📤 ${AUDIENCES[audience].label}: ${summary.total} ta foydalanuvchi\n💳 Sotib olganlar: ${summary.buyers}\n💰 Jami: ${formatSum(summary.revenue)}`;
    await Promise.all([ctx.replyWithDocument(new InputFile(stream, exportFileName(format)), { caption }), writing]);
    await audit(ctx.admin?.id ?? null, "export_users", "user", null, null, { format, audience, total: summary.total });
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 413) {
      await ctx.reply("⚠️ Fayl Telegram limiti (50 MB) dan katta. Uni veb admin paneldan yuklab oling.");
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
