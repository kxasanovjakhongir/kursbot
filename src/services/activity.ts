import { prisma } from "../db";
import { logger } from "../lib/logger";

export const ACTIONS = [
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  "UPDATE_PROFILE",
  "CHANGE_PASSWORD",
  "CREATE_USER",
  "UPDATE_USER",
  "DELETE_USER",
  "CREATE_BROADCAST",
  "SEND_BROADCAST",
  "UPDATE_BOT_SETTINGS",
  "UPDATE_BOT_TOKEN",
  "UPDATE_MAINTENANCE",
  "CREATE_BOT_COMMAND",
  "UPDATE_BOT_COMMAND",
  "DELETE_BOT_COMMAND",
  "CREATE_MENU_ITEM",
  "UPDATE_MENU_ITEM",
  "DELETE_MENU_ITEM",
  "REORDER_MENU",
  "UPDATE_PRODUCT",
  "UPLOAD_VIDEO",
  "CREATE_CARD",
  "UPDATE_CARD",
  "DELETE_CARD",
  "APPROVE_ORDER",
  "REJECT_ORDER",
] as const;

export type ActivityAction = (typeof ACTIONS)[number];

export async function logActivity(
  panelUserId: number | null,
  action: ActivityAction,
  description: string,
  ipAddress?: string | null,
): Promise<void> {
  try {
    await prisma.activityLog.create({ data: { panelUserId, action, description, ipAddress: ipAddress ?? null } });
  } catch (err) {
    logger.warn({ err, action }, "activity log yozilmadi");
  }
}
