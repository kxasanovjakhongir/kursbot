import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { logActivity } from "../../services/activity";
import { COMMAND_RE, normalizeCommand } from "../../services/botConfig";
import { currentUser } from "../auth";
import { HttpError } from "../errors";
import { clientIp, parseBody, parseId } from "../validate";

// Bu buyruqlar savdo oqimiga tegishli — bazadagi javob bilan almashtirilmaydi
const RESERVED = new Set(["start", "admin", "pending", "products"]);

const commandField = z
  .string()
  .transform(normalizeCommand)
  .refine((c) => COMMAND_RE.test(c), "Faqat kichik lotin harflari, raqamlar va _ (1–32 belgi)")
  .refine((c) => !RESERVED.has(c), "Bu tizim buyrug'i — uni o'zgartirib bo'lmaydi");

const createSchema = z.object({
  command: commandField,
  description: z.string().trim().max(256).default(""),
  response: z.string().trim().min(1).max(4096),
  isActive: z.boolean().default(true),
});

export const commandsRouter = Router();

commandsRouter.get("/", async (_req, res) => {
  res.json({ items: await prisma.botCommand.findMany({ orderBy: { command: "asc" } }) });
});

commandsRouter.post("/", async (req, res) => {
  const body = parseBody(createSchema, req);
  const cmd = await prisma.botCommand.create({ data: body });
  await logActivity(currentUser(req).id, "CREATE_BOT_COMMAND", `Buyruq yaratildi: /${cmd.command}`, clientIp(req));
  res.status(201).json(cmd);
});

commandsRouter.put("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const body = parseBody(createSchema.partial(), req);
  const cmd = await prisma.botCommand.update({ where: { id }, data: body });
  await logActivity(currentUser(req).id, "UPDATE_BOT_COMMAND", `Buyruq yangilandi: /${cmd.command}`, clientIp(req));
  res.json(cmd);
});

commandsRouter.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const cmd = await prisma.botCommand.findUnique({ where: { id } });
  if (!cmd) throw new HttpError(404, "Buyruq topilmadi");
  await prisma.botCommand.delete({ where: { id } });
  await logActivity(currentUser(req).id, "DELETE_BOT_COMMAND", `Buyruq o'chirildi: /${cmd.command}`, clientIp(req));
  res.status(204).end();
});
