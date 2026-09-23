import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { logActivity } from "../../services/activity";
import { countActiveSuperAdmins, createPanelUser, hashPassword, toSafe } from "../../services/panelUsers";
import { currentUser } from "../auth";
import { HttpError } from "../errors";
import { clientIp, parseBody, parseId } from "../validate";

/** Panel adminlarini boshqarish — faqat SUPER_ADMIN (app.ts da requireSuperAdmin) */
export const adminsRouter = Router();

const role = z.enum(["admin", "superadmin"]);

adminsRouter.get("/", async (_req, res) => {
  const users = await prisma.panelUser.findMany({ orderBy: { createdAt: "asc" } });
  res.json({ items: users.map(toSafe) });
});

adminsRouter.post("/", async (req, res) => {
  const body = parseBody(
    z.object({
      email: z.string().trim().email().max(200),
      name: z.string().trim().min(2).max(100),
      password: z.string().min(8).max(200),
      role,
    }),
    req,
  );
  const user = await createPanelUser(body);
  await logActivity(currentUser(req).id, "CREATE_USER", `Admin yaratildi: ${user.email} (${user.role})`, clientIp(req));
  res.status(201).json(toSafe(user));
});

adminsRouter.put("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const me = currentUser(req);
  const body = parseBody(
    z.object({
      name: z.string().trim().min(2).max(100).optional(),
      role: role.optional(),
      isActive: z.boolean().optional(),
      password: z.string().min(8).max(200).optional(),
    }),
    req,
  );
  const target = await prisma.panelUser.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, "Admin topilmadi");
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
      ...(body.password ? { passwordHash: await hashPassword(body.password) } : {}),
    },
  });
  const changes = Object.keys(body).map((k) => (k === "password" ? "parol" : k)).join(", ");
  await logActivity(me.id, "UPDATE_USER", `Admin yangilandi: ${updated.email} (${changes})`, clientIp(req));
  res.json(toSafe(updated));
});

adminsRouter.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const me = currentUser(req);
  if (id === me.id) throw new HttpError(400, "O'zingizni o'chira olmaysiz");
  const target = await prisma.panelUser.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, "Admin topilmadi");
  if (target.role === "superadmin" && (await countActiveSuperAdmins(id)) === 0) {
    throw new HttpError(400, "Oxirgi Super Adminni o'chirib bo'lmaydi");
  }
  await prisma.panelUser.delete({ where: { id } });
  await logActivity(me.id, "DELETE_USER", `Admin o'chirildi: ${target.email}`, clientIp(req));
  res.status(204).end();
});
