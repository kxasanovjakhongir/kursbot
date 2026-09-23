import type { Api } from "grammy";
import { prisma } from "../db";
import { logger } from "../lib/logger";

/** Menyuni Telegram'ga yuboradi (chatdagi "Menu" tugmasi) */
export async function syncBotMenu(api: Api): Promise<void> {
  const items = await prisma.botMenuItem.findMany({ where: { isActive: true }, orderBy: [{ order: "asc" }, { id: "asc" }] });
  try {
    await api.setMyCommands(items.map((i) => ({ command: i.command, description: i.description.slice(0, 256) || i.name })));
  } catch (err) {
    logger.error({ err }, "bot menyusi Telegram'ga yuborilmadi");
    throw err;
  }
}

export async function findActiveCommand(command: string) {
  return prisma.botCommand.findFirst({ where: { command: command.toLowerCase(), isActive: true } });
}

/** Buyruq nomi: 1–32 belgi, kichik lotin harflari, raqamlar va _ (Telegram talabi) */
export function normalizeCommand(raw: string): string {
  return raw.trim().replace(/^\//, "").toLowerCase();
}

export const COMMAND_RE = /^[a-z0-9_]{1,32}$/;
