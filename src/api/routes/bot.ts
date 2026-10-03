import { Router } from "express";
import { Api } from "grammy";
import { z } from "zod";
import { prisma } from "../../db";
import { logActivity } from "../../services/activity";
import { saveBotToken } from "../../services/botToken";
import { isButtonId, listButtons, resetButtons, setButtons } from "../../services/buttons";
import { COURSE_NAME_MAX_LENGTH_LIMIT, getSettings, setSetting } from "../../services/settings";
import { editableTextError, getEditableTexts, isEditableText, saveEditableTexts, setTextsEnabled } from "../../services/texts";
import { LANGS } from "../../i18n";
import { normalizeTelegramUsername, TELEGRAM_USERNAME_ERROR } from "../../lib/telegramUsername";
import { currentUser, requirePermission } from "../auth";
import { HttpError } from "../errors";
import type { BotRuntime } from "../runtime";
import { clientIp, parseBody } from "../validate";

const TOKEN_MASK = "••••••••••••••••••••";

export function botRouter(rt: BotRuntime): Router {
  const r = Router();

  /** Bot haqiqatan ishlayotganini Telegram API orqali tekshiradi */
  r.get("/status", async (_req, res) => {
    const totalUsers = await prisma.user.count({ where: { isBot: false } });
    const { maintenance_mode } = await getSettings();
    const checkedAt = new Date();
    try {
      const me = await rt.api.getMe();
      res.json({
        online: rt.isRunning(),
        reachable: true,
        name: me.first_name,
        username: me.username,
        id: me.id,
        mode: rt.mode,
        maintenance: maintenance_mode,
        totalUsers,
        checkedAt,
      });
    } catch (err) {
      res.json({
        online: false,
        reachable: false,
        error: err instanceof Error ? err.message : String(err),
        mode: rt.mode,
        maintenance: maintenance_mode,
        totalUsers,
        checkedAt,
      });
    }
  });

  r.get("/info", async (_req, res) => {
    const me = await rt.api.getMe();
    res.json({
      id: me.id,
      name: me.first_name,
      username: me.username,
      canJoinGroups: me.can_join_groups,
      canReadAllGroupMessages: me.can_read_all_group_messages,
    });
  });

  // ---------- Faqat SUPER_ADMIN ----------
  r.get("/settings", requirePermission("settings.manage"), async (_req, res) => {
    const s = await getSettings();
    const me = await rt.api.getMe();
    res.json({
      botName: me.first_name,
      botUsername: me.username,
      // Token frontendga hech qachon yuborilmaydi
      botToken: TOKEN_MASK,
      tokenSource: rt.tokenSource,
      welcomeMessage: s.welcome_message ?? "",
      defaultLanguage: s.default_language,
      maintenanceMode: s.maintenance_mode,
      workStart: s.work_start,
      workEnd: s.work_end,
      supportUsername: s.support_username ?? "",
      courseNameMaxLength: s.course_name_max_length,
    });
  });

  const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM formatida");
  const settingsSchema = z.object({
    botName: z.string().trim().min(1).max(64).optional(),
    welcomeMessage: z.string().max(4000).optional(),
    defaultLanguage: z.enum(["uz", "ru", "en"]).optional(),
    workStart: hm.optional(),
    workEnd: hm.optional(),
    // "Yordam" profili: "@support", "support", "https://t.me/support" → "support"; bo'sh — o'chirish
    courseNameMaxLength: z.number().int("Butun son bo'lishi kerak").min(1, "Kamida 1").max(COURSE_NAME_MAX_LENGTH_LIMIT, `Ko'pi bilan ${COURSE_NAME_MAX_LENGTH_LIMIT}`).optional(),
    supportUsername: z
      .string()
      .max(64)
      .transform((v, zctx) => {
        if (!v.trim()) return null;
        const username = normalizeTelegramUsername(v);
        if (!username) zctx.addIssue({ code: "custom", message: TELEGRAM_USERNAME_ERROR });
        return username ?? z.NEVER;
      })
      .optional(),
  });

  r.put("/settings", requirePermission("settings.manage"), async (req, res) => {
    const body = parseBody(settingsSchema, req);
    const changed: string[] = [];
    if (body.botName !== undefined) {
      const me = await rt.api.getMe();
      if (me.first_name !== body.botName) {
        await rt.api.setMyName(body.botName);
        changed.push(`nomi: ${body.botName}`);
      }
    }
    if (body.welcomeMessage !== undefined) {
      await setSetting("welcome_message", body.welcomeMessage.trim() || null);
      changed.push("welcome message");
    }
    if (body.defaultLanguage !== undefined) {
      await setSetting("default_language", body.defaultLanguage);
      changed.push(`til: ${body.defaultLanguage}`);
    }
    if (body.workStart !== undefined) {
      await setSetting("work_start", body.workStart);
      changed.push(`ish boshi: ${body.workStart}`);
    }
    if (body.workEnd !== undefined) {
      await setSetting("work_end", body.workEnd);
      changed.push(`ish oxiri: ${body.workEnd}`);
    }
    if (body.courseNameMaxLength !== undefined) {
      await setSetting("course_name_max_length", body.courseNameMaxLength);
      changed.push(`kurs nomi uzunligi: ${body.courseNameMaxLength}`);
    }
    if (body.supportUsername !== undefined) {
      await setSetting("support_username", body.supportUsername);
      changed.push(`yordam: ${body.supportUsername ? `@${body.supportUsername}` : "o'chirildi"}`);
    }
    await logActivity(currentUser(req).id, "UPDATE_BOT_SETTINGS", `Sozlamalar: ${changed.join(", ") || "o'zgarish yo'q"}`, clientIp(req));
    res.json({ ok: true });
  });

  // ---------- Bot matnlari: barcha tayyor xabar shablonlari (bo'limlar bo'yicha, til bo'yicha) ----------
  const langQuery = z.object({ lang: z.enum(LANGS).default("uz") });

  r.get("/texts", requirePermission("settings.manage"), async (req, res) => {
    const { lang } = langQuery.parse(req.query);
    res.json(await getEditableTexts(lang));
  });

  const textsSchema = z
    .object({
      lang: z.enum(LANGS, { errorMap: () => ({ message: "Til noto'g'ri" }) }),
      values: z.record(z.string().max(4096)).refine((v) => Object.keys(v).length <= 200, "Juda ko'p matn").default({}),
      // Matnni yoqish/o'chirish (barcha tillarda). Bo'sh saqlangan matn o'z-o'zidan o'chirilgan hisoblanadi
      enabled: z.record(z.boolean()).refine((v) => Object.keys(v).length <= 200, "Juda ko'p matn").default({}),
    })
    .superRefine((body, zctx) => {
      for (const [key, value] of Object.entries(body.values)) {
        const error = isEditableText(key) ? editableTextError(key, value) : "Bunday matn yo'q yoki uni tahrirlab bo'lmaydi.";
        if (error) zctx.addIssue({ code: "custom", path: [key], message: error });
      }
      for (const key of Object.keys(body.enabled)) {
        if (!isEditableText(key)) zctx.addIssue({ code: "custom", path: [key], message: "Bunday matn yo'q yoki uni tahrirlab bo'lmaydi." });
      }
    });

  r.put("/texts", requirePermission("settings.manage"), async (req, res) => {
    const body = parseBody(textsSchema, req);
    const changed = [...(await saveEditableTexts(body.lang, body.values)), ...(await setTextsEnabled(body.lang, body.enabled))];
    await logActivity(currentUser(req).id, "UPDATE_BOT_TEXTS", `Bot matnlari (${body.lang}): ${changed.join(", ") || "o'zgarish yo'q"}`, clientIp(req));
    res.json(await getEditableTexts(body.lang));
  });

  // ---------- Bot tugmalari: xabar ostidagi yordamchi tugmalarni yoqish/o'chirish ----------
  r.get("/buttons", requirePermission("settings.manage"), async (_req, res) => {
    res.json({ screens: await listButtons() });
  });

  const buttonsSchema = z.object({
    values: z.record(z.boolean()).superRefine((v, zctx) => {
      for (const id of Object.keys(v)) {
        if (!isButtonId(id)) zctx.addIssue({ code: "custom", path: [id], message: "Bunday tugma yo'q." });
      }
    }),
  });

  r.put("/buttons", requirePermission("settings.manage"), async (req, res) => {
    const { values } = parseBody(buttonsSchema, req);
    const changed = await setButtons(values);
    await logActivity(currentUser(req).id, "UPDATE_BOT_BUTTONS", `Bot tugmalari: ${changed.join(", ") || "o'zgarish yo'q"}`, clientIp(req));
    res.json({ screens: await listButtons() });
  });

  r.post("/buttons/reset", requirePermission("settings.manage"), async (req, res) => {
    await resetButtons();
    await logActivity(currentUser(req).id, "UPDATE_BOT_BUTTONS", "Bot tugmalari: standart holatga qaytarildi", clientIp(req));
    res.json({ screens: await listButtons() });
  });

  r.put("/maintenance", requirePermission("settings.manage"), async (req, res) => {
    const { enabled } = parseBody(z.object({ enabled: z.boolean() }), req);
    await setSetting("maintenance_mode", enabled);
    await logActivity(currentUser(req).id, "UPDATE_MAINTENANCE", `Maintenance mode: ${enabled ? "ON" : "OFF"}`, clientIp(req));
    res.json({ maintenance: enabled });
  });

  r.put("/token", requirePermission("settings.manage"), async (req, res) => {
    const { token } = parseBody(z.object({ token: z.string().trim().regex(/^\d+:[\w-]{30,}$/, "Token formati noto'g'ri") }), req);
    let username: string | undefined;
    try {
      username = (await new Api(token).getMe()).username;
    } catch {
      throw new HttpError(400, "Token yaroqsiz — Telegram uni qabul qilmadi");
    }
    await saveBotToken(token);
    await logActivity(currentUser(req).id, "UPDATE_BOT_TOKEN", `Bot tokeni yangilandi (@${username})`, clientIp(req));
    res.json({ ok: true, username, restartRequired: true });
  });

  return r;
}
