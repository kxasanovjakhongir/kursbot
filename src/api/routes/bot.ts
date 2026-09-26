import { Router } from "express";
import { Api } from "grammy";
import { z } from "zod";
import { prisma } from "../../db";
import { logActivity } from "../../services/activity";
import { saveBotToken } from "../../services/botToken";
import { getSettings, setSetting } from "../../services/settings";
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
    });
  });

  const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM formatida");
  const settingsSchema = z.object({
    botName: z.string().trim().min(1).max(64).optional(),
    welcomeMessage: z.string().max(4000).optional(),
    defaultLanguage: z.enum(["uz", "ru", "en"]).optional(),
    workStart: hm.optional(),
    workEnd: hm.optional(),
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
    await logActivity(currentUser(req).id, "UPDATE_BOT_SETTINGS", `Sozlamalar: ${changed.join(", ") || "o'zgarish yo'q"}`, clientIp(req));
    res.json({ ok: true });
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
