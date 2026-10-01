import { Bot, GrammyError, HttpError, type BotConfig, type Transformer } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { sequentialize } from "@grammyjs/runner";
import { BotContext } from "./context";
import { customer } from "./handlers/customer";
import { receipt } from "./handlers/receipt";
import { joinRequest } from "./handlers/joinRequest";
import { channelMembership } from "./handlers/channelMembership";
import { dynamicCommands } from "./handlers/dynamicCommands";
import { builtinCommands, navigation } from "./handlers/navigation";
import { review } from "./admin/review";
import { adminCommands } from "./admin/commands";
import { adminMenu } from "./admin/menu";
import { adminsManage } from "./admin/adminsManage";
import { adminLessons } from "./admin/lessons";
import { adminExport } from "./admin/export";
import { accessGuard } from "./middleware/accessGuard";
import { autoAnswerCallbacks } from "./middleware/autoAnswer";
import { errorBoundary, handleBotError, RetryLaterError } from "./middleware/errorBoundary";
import { identify } from "./middleware/identify";
import { requestLog } from "./middleware/requestLog";
import { throttle } from "./middleware/throttle";
import { mainMenu, phoneKeyboard } from "./keyboards";
import { homeScreen } from "./screens/home";
import { render } from "./ui/render";
import { installOutgoingLogger, logIncoming } from "./messageLog";
import { listOpenOrders } from "../services/orders";
import { telegramApiCalls } from "../lib/metrics";

export type CreateBotOptions = Omit<BotConfig<BotContext>, "ContextConstructor">;

/** Har bir Telegram API chaqiruvi natijasi metrikaga (xato kodi bo'yicha) */
const apiMetrics: Transformer = async (prev, method, payload, signal) => {
  try {
    const res = await prev(method, payload, signal);
    telegramApiCalls.inc({ method, result: res.ok ? "ok" : `error_${res.error_code}` });
    return res;
  } catch (err) {
    telegramApiCalls.inc({ method, result: err instanceof HttpError ? "network" : err instanceof GrammyError ? `error_${err.error_code}` : "exception" });
    throw err;
  }
};

/**
 * Parallel qayta ishlashda bitta chat (yoki chatsiz update da — foydalanuvchi) update lari
 * ketma-ket bajariladi: tugmani tez-tez bosish yoki chek + matn aralashib ketmaydi.
 */
export const updateKey = (ctx: BotContext): string | undefined => (ctx.chat?.id ?? ctx.from?.id)?.toString();

export function createBot(token: string, options: CreateBotOptions = {}): Bot<BotContext> {
  const bot = new Bot<BotContext>(token, { ...options, ContextConstructor: BotContext });
  // Transformerlar tartibi: oxirgi o'rnatilgani tashqi. autoRetry har urinishni metrikadan o'tkazadi,
  // chiquvchi xabar logi esa faqat muvaffaqiyatli javobni bir marta yozadi
  installOutgoingLogger(bot.api);
  bot.api.config.use(apiMetrics);
  // 429 (flood) — retry_after qadar kutib qayta; tarmoq/5xx xatolari — exponential backoff bilan
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60, rethrowInternalServerErrors: false }));

  // --- Infratuzilma (tartib muhim) ---
  bot.use(sequentialize(updateKey)); // bitta chat ichida tartib (parallel runner/webhook uchun)
  bot.use(requestLog); // kontekstli log va davomiylik
  bot.use(errorBoundary); // har qanday xato → log + foydalanuvchiga tushunarli xabar
  bot.use(autoAnswerCallbacks); // inline tugmada "soat" aylanib qolmaydi
  bot.use(throttle({ windowMs: 10_000, limit: 20 })); // spam — bazaga tegmasdan tashlanadi
  bot.use(identify); // foydalanuvchi, admin, rol, til

  // Xabarlar tarixi (admin panel: Message History)
  bot.on("message", async (ctx, next) => {
    await logIncoming(ctx.message, ctx.user?.id);
    await next();
  });

  bot.use(accessGuard); // cheklangan foydalanuvchi va maintenance

  // --- Handlerlar. Admin buyruqlari va tugmalari mijoz oqimidan oldin ---
  bot.use(adminCommands);
  bot.use(adminMenu);
  bot.use(adminsManage); // adminlarni qo'shish/o'zgartirish (ID kiritish kutilayotgan xabar ham shu yerda)
  bot.use(adminLessons); // kurs darslari: video yuborish/forward → kurs → nom (chek oqimidan oldin)
  bot.use(adminExport); // foydalanuvchilar bazasini fayl sifatida olish
  bot.use(review);
  bot.use(joinRequest);
  bot.use(channelMembership);
  bot.use(customer);
  bot.use(navigation);
  bot.use(receipt);
  bot.use(dynamicCommands);
  bot.use(builtinCommands);

  // --- Hech bir handler olmagan update lar ---
  const pm = bot.chatType("private");

  pm.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) {
      await ctx.reply(await ctx.t("error_unknown_command"), { reply_markup: mainMenu(ctx.lang, ctx.role) });
      return;
    }
    const user = ctx.user!;
    if (!user.phone) {
      // Qo'lda yozilgan raqam qabul qilinmaydi (TZ 5.2)
      await ctx.reply(await ctx.t("phone_own_only"), { parse_mode: "HTML", reply_markup: phoneKeyboard(ctx.lang) });
      return;
    }
    const open = await listOpenOrders(user.id);
    if (open.some((o) => o.status === "new" || o.status === "rejected")) {
      await ctx.reply(await ctx.t("receipt_invalid"));
      return;
    }
    // 2-bosqich: "Savol berish" — support yozishma (TZ 7.4)
    await render(ctx, await homeScreen(ctx));
  });

  // Eskirgan yoki noma'lum tugma — foydalanuvchi nima bo'lganini tushunsin
  bot.on("callback_query", async (ctx) => {
    await ctx.answerCallbackQuery({ text: await ctx.t("error_stale_button"), show_alert: true });
  });

  // Oxirgi himoya chizig'i (masalan, errorBoundary ning o'zi xato bersa)
  bot.catch(async (err) => {
    // Qayta yuborilishi kerak bo'lgan update — xato webhook javobiga chiqadi (Telegram retry qiladi)
    if (err.error instanceof RetryLaterError) throw err.error;
    await handleBotError(err.ctx, err.error);
  });

  return bot;
}
