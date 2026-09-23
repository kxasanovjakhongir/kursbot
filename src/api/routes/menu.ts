import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { logActivity } from "../../services/activity";
import { COMMAND_RE, normalizeCommand, syncBotMenu } from "../../services/botConfig";
import { currentUser } from "../auth";
import { HttpError } from "../errors";
import type { BotRuntime } from "../runtime";
import { clientIp, parseBody, parseId } from "../validate";

const schema = z.object({
  name: z.string().trim().min(1).max(64),
  command: z
    .string()
    .transform(normalizeCommand)
    .refine((c) => COMMAND_RE.test(c), "Faqat kichik lotin harflari, raqamlar va _ (1–32 belgi)"),
  description: z.string().trim().min(1).max(256),
  order: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().default(true),
});

export function menuRouter(rt: BotRuntime): Router {
  const r = Router();
  const list = () => prisma.botMenuItem.findMany({ orderBy: [{ order: "asc" }, { id: "asc" }] });

  r.get("/", async (_req, res) => {
    res.json({ items: await list() });
  });

  r.post("/", async (req, res) => {
    const body = parseBody(schema, req);
    const max = await prisma.botMenuItem.aggregate({ _max: { order: true } });
    const item = await prisma.botMenuItem.create({ data: { ...body, order: body.order ?? (max._max.order ?? 0) + 1 } });
    await syncBotMenu(rt.api);
    await logActivity(currentUser(req).id, "CREATE_MENU_ITEM", `Menyu: /${item.command}`, clientIp(req));
    res.status(201).json(item);
  });

  /** Tartibni o'zgartirish: ID lar yangi tartibda */
  r.put("/reorder", async (req, res) => {
    const { ids } = parseBody(z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) }), req);
    await prisma.$transaction(ids.map((id, i) => prisma.botMenuItem.update({ where: { id }, data: { order: i + 1 } })));
    await syncBotMenu(rt.api);
    await logActivity(currentUser(req).id, "REORDER_MENU", "Menyu tartibi o'zgartirildi", clientIp(req));
    res.json({ items: await list() });
  });

  r.put("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const body = parseBody(schema.partial(), req);
    const item = await prisma.botMenuItem.update({ where: { id }, data: body });
    await syncBotMenu(rt.api);
    await logActivity(currentUser(req).id, "UPDATE_MENU_ITEM", `Menyu: /${item.command}`, clientIp(req));
    res.json(item);
  });

  r.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const item = await prisma.botMenuItem.findUnique({ where: { id } });
    if (!item) throw new HttpError(404, "Menyu elementi topilmadi");
    await prisma.botMenuItem.delete({ where: { id } });
    await syncBotMenu(rt.api);
    await logActivity(currentUser(req).id, "DELETE_MENU_ITEM", `Menyu o'chirildi: /${item.command}`, clientIp(req));
    res.status(204).end();
  });

  return r;
}
