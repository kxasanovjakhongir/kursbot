import type { Api } from "grammy";
import { isWorkingTime } from "../lib/format";
import { logger } from "../lib/logger";
import { attachReceipt, setReceiptAdminMessage, type AttachReceiptResult, type IncomingReceipt } from "../services/orders";
import { trackEvent } from "../services/events";
import { getAdminGroupId, getSettings } from "../services/settings";
import { postReceiptCard } from "./admin/receiptCard";

export type SubmitReceiptResult =
  | { kind: "ok"; orderId: bigint; attempt: number; working: boolean; workStart: string; attached: Extract<AttachReceiptResult, { kind: "ok" }> }
  | { kind: "under_review" }
  | { kind: "closed" }
  | { kind: "max_attempts" };

/**
 * Chekni buyurtmaga biriktiradi (TZ 5.5, BR-04). Bot (chatga yuborilgan rasm) ham, Mini App (yuklangan fayl) ham shuni chaqiradi.
 * Adminlarga yuborish alohida — mijozga javob kechikmasligi uchun `forwardReceiptToAdmins` keyin chaqiriladi.
 */
export async function submitReceipt(userId: bigint, orderId: bigint, file: IncomingReceipt): Promise<SubmitReceiptResult> {
  const res = await attachReceipt(orderId, file);
  if (res.kind === "under_review" || res.kind === "closed" || res.kind === "max_attempts") return { kind: res.kind };

  await trackEvent(userId, "receipt", { orderId: orderId.toString(), attempt: res.order.attempts, duplicate: res.isDuplicate });
  const settings = await getSettings();
  return {
    kind: "ok",
    orderId,
    attempt: res.order.attempts,
    working: isWorkingTime(new Date(), settings.work_start, settings.work_end),
    workStart: settings.work_start,
    attached: res,
  };
}

/**
 * Chek kartochkasini admin guruhiga yuboradi. Xato bo'lsa ham chek bazada saqlangan
 * (panelda va /pending da ko'rinadi) — shuning uchun mijozga xato ko'rsatilmaydi, faqat log.
 */
export async function forwardReceiptToAdmins(api: Api, result: Extract<SubmitReceiptResult, { kind: "ok" }>): Promise<void> {
  try {
    const groupId = await getAdminGroupId();
    if (!groupId) {
      logger.error("ADMIN_GROUP_ID sozlanmagan — chek admin guruhiga yuborilmadi");
      return;
    }
    const { previous, receipt } = result.attached;
    // Qayta urinishda oldingi chek xabariga reply qilinadi — admin ikkalasini birga ko'radi (BR-06)
    const replyTo = previous?.adminMessageId && previous.adminChatId === groupId ? Number(previous.adminMessageId) : undefined;
    const msg = await postReceiptCard(api, groupId, result.orderId, replyTo);
    await setReceiptAdminMessage(receipt.id, groupId, msg.message_id);
  } catch (err) {
    logger.error({ err, orderId: result.orderId.toString() }, "chek admin guruhiga yuborilmadi");
  }
}
