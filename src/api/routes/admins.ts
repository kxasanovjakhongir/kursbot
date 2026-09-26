import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { logActivity } from "../../services/activity";
import { countActiveSuperAdmins, createPanelUser, hashPassword, toSafe } from "../../services/panelUsers";
import { syncBotAdminFromPanel } from "../../services/admins";
import { notifyAdminGranted } from "../../bot/admin/adminsManage";
import type { BotRuntime } from "../runtime";
import { currentUser } from "../auth";
import { HttpError } from "../errors";
import { clientIp, parseBody, parseId } from "../validate";

const role = z.enum(["admin", "superadmin"]);

/** Telegram ID (ixtiyoriy): berilsa shu odam botda ham admin bo'ladi. null/"" — bog'lanish olib tashlanadi */
const telegramIdField = z
  .union([z.string().trim(), z.null()])
  .optional()
  .refine((v) => v === undefined || v === null || v === "" || /^\d{5,15}$/.test(v), "Telegram ID — 5–15 ta raqam")
  .transform((v) => (v === undefined ? undefined : v ? BigInt(v) : null));

/** Bitta Telegram hisobi faqat bitta panel adminiga biriktiriladi */
async function assertTelegramFree(telegramId: bigint | null | undefined, exceptId?: number): Promise<void> {
  if (!telegramId) return;
  const other = await prisma.panelUser.findUnique({ where: { telegramId }, select: { id: true, email: true } });
  if (other && other.id !== exceptId) throw new HttpError(409, `Bu Telegram ID boshqa adminga biriktirilgan: ${other.email}`);
}

/**
 * Panel adminlarini boshqarish — faqat SUPER_ADMIN (app.ts da requirePermission("admins.manage")).
 * Telegram ID berilgan admin botda ham xuddi shu rol bilan admin bo'ladi (sinxron).
 */
export function adminsRouter(rt: BotRuntime): Router {
  const r = Router();

  /** Bot bilan sinxronlash va yangi huquq berilgan bo'lsa — Telegram'da xabar */
  const syncBot = async (user: Parameters<typeof syncBotAdminFromPanel>[0], previous: bigint | null) => {
    const { granted } = await syncBotAdminFromPanel(user, previous);
    if (granted && user.telegramId) await notifyAdminGranted(rt.api, user.telegramId, granted);
  };

  r.get("/", async (_req, res) => {
    const users = await prisma.panelUser.findMany({ orderBy: { createdAt: "asc" } });
    const ids = users.map((u) => u.telegramId).filter((id): id is bigint => id !== null);
    const botAdmins = ids.length ? await prisma.admin.findMany({ where: { telegramId: { in: ids } }, select: { telegramId: true, role: true, isActive: true } }) : [];
    const byId = new Map(botAdmins.map((a) => [a.telegramId, a]));
    res.json({
      items: users.map((u) => {
        const bot = u.telegramId ? byId.get(u.telegramId) : undefined;
        return { ...toSafe(u), bot: bot?.isActive ? { role: bot.role } : null };
      }),
    });
  });

  r.post("/", async (req, res) => {
    const body = parseBody(
      z.object({
        email: z.string().trim().email().max(200),
        name: z.string().trim().min(2).max(100),
        password: z.string().min(8).max(200),
        role,
        telegramId: telegramIdField,
      }),
      req,
    );
    await assertTelegramFree(body.telegramId);
    const created = await createPanelUser(body);
    const user = body.telegramId ? await prisma.panelUser.update({ where: { id: created.id }, data: { telegramId: body.telegramId } }) : created;
    await syncBot(user, null);
    await logActivity(currentUser(req).id, "CREATE_USER", `Admin yaratildi: ${user.email} (${user.role})${user.telegramId ? `, Telegram: ${user.telegramId}` : ""}`, clientIp(req));
    res.status(201).json(toSafe(user));
  });

  r.put("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const me = currentUser(req);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(2).max(100).optional(),
        role: role.optional(),
        isActive: z.boolean().optional(),
        password: z.string().min(8).max(200).optional(),
        telegramId: telegramIdField,
      }),
      req,
    );
    const target = await prisma.panelUser.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, "Admin topilmadi");
    await assertTelegramFree(body.telegramId, id);
    const demoting = (body.role && body.role !== "superadmin") || body.isActive === false;
    if (target.role === "superadmin" && demoting && (await countActiveSuperAdmins(id)) === 0) {
      throw new HttpError(400, "Oxirgi Super Adminni o'zgartirib bo'lmaydi");
    }
    if (id === me.id && demoting) throw new HttpError(400, "O'z rolingizni pasaytira yoki o'chira olmaysiz");

    const updated = await prisma.panelUser.update({
      where: { id },
      data: {
        name: body.name,
        role: body.role,
        isActive: body.isActive,
        telegramId: body.telegramId,
        ...(body.password ? { passwordHash: await hashPassword(body.password) } : {}),
      },
    });
    // Rol, holat yoki Telegram ID o'zgarsa — botdagi huquq ham shunga moslanadi
    await syncBot(updated, target.telegramId);
    const changes = Object.keys(body).map((k) => (k === "password" ? "parol" : k)).join(", ");
    await logActivity(me.id, "UPDATE_USER", `Admin yangilandi: ${updated.email} (${changes})`, clientIp(req));
    res.json(toSafe(updated));
  });

  r.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const me = currentUser(req);
    if (id === me.id) throw new HttpError(400, "O'zingizni o'chira olmaysiz");
    const target = await prisma.panelUser.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, "Admin topilmadi");
    if (target.role === "superadmin" && (await countActiveSuperAdmins(id)) === 0) {
      throw new HttpError(400, "Oxirgi Super Adminni o'chirib bo'lmaydi");
    }
    await prisma.panelUser.delete({ where: { id } });
    // Botdagi huquq ham olinadi (.env dagi super admin bundan mustasno)
    if (target.telegramId) await syncBotAdminFromPanel({ ...target, isActive: false }, null);
    await logActivity(me.id, "DELETE_USER", `Admin o'chirildi: ${target.email}`, clientIp(req));
    res.status(204).end();
  });

  return r;
}
