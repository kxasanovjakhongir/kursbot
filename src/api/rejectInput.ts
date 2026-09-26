import { z } from "zod";
import { isRejectReason, REJECT_REASONS, type RejectReasonCode } from "../services/texts";
import { HttpError } from "./errors";

export const rejectSchema = z.object({
  reason: z.string().refine(isRejectReason, "Noma'lum sabab"),
  amount: z.number().int().positive().optional(),
  text: z.string().trim().min(1).max(500).optional(),
});

/** Rad etish so'rovi: "Summa kam" — summa, "Boshqa" — matn majburiy. rejectAndNotify uchun (code, extra) qaytaradi */
export function parseRejectInput(body: z.infer<typeof rejectSchema>): { code: RejectReasonCode; extra: string | null } {
  if (!isRejectReason(body.reason)) throw new HttpError(400, "Noma'lum sabab");
  if (body.reason === "short" && !body.amount) throw new HttpError(400, "Yetishmayotgan summani kiriting");
  if (body.reason === "other" && !body.text) throw new HttpError(400, "Sababni yozing");
  const extra = body.reason === "short" ? String(body.amount) : body.reason === "other" ? (body.text ?? null) : null;
  return { code: body.reason, extra };
}

/** Tanlov ro'yxati: needsInput — qo'shimcha maydon kerak */
export function rejectReasonList() {
  return Object.entries(REJECT_REASONS).map(([code, v]) => ({ code, label: v.label, needsInput: code === "short" || code === "other" }));
}
