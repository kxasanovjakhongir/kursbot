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
  "CREATE_PRODUCT",
  "UPDATE_PRODUCT",
  "CREATE_LINK",
  "UPDATE_LINK",
  "DELETE_LINK",
  "DELETE_PRODUCT",
  "UPLOAD_VIDEO",
  "CREATE_CARD",
  "UPDATE_CARD",
  "DELETE_CARD",
  "APPROVE_ORDER",
  "REJECT_ORDER",
  "CANCEL_ORDER",
  "RESOLVE_ERROR",
  "BAN_USER",
  "UNBAN_USER",
  "REMOVE_FROM_CHANNEL",
  "UPDATE_ACCESS_EXPIRY",
  "SEND_USER_MESSAGE",
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
