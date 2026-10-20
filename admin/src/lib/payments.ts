import type { PaymentTx, PaymentTxEvent } from "./types";

/** Payme / Click: ro'yxat va tafsilot sahifasi uchun umumiy yorliqlar */

export const PROVIDER_LABEL: Record<PaymentTx["provider"], string> = { payme: "Payme", click: "Click" };

/** Payme bekor qilish sabablari (Merchant API, CancelTransaction.reason) */
const PAYME_REASON: Record<number, string> = {
  1: "Qabul qiluvchi topilmadi yoki faol emas",
  2: "Hisobdan yechishda xato",
  3: "Tranzaksiya bajarilmadi",
  4: "Vaqt tugadi",
  5: "Pul qaytarildi",
  10: "Noma'lum xato",
};

/** Click Shop API xato kodlari (complete.error yoki bizning javob) */
const CLICK_ERROR: Record<number, string> = {
  [-1]: "Imzo noto'g'ri",
  [-2]: "Summa noto'g'ri",
  [-3]: "Amal topilmadi",
  [-4]: "Allaqachon to'langan",
  [-5]: "Buyurtma topilmadi",
  [-6]: "Tranzaksiya topilmadi",
  [-7]: "Saqlashda xato",
  [-8]: "So'rov noto'g'ri",
  [-9]: "Tranzaksiya bekor qilingan",
};

/** Payme Merchant API xato kodlari (bizning javob) */
const PAYME_ERROR: Record<number, string> = {
  [-32504]: "Kalit noto'g'ri",
  [-32300]: "So'rov POST emas",
  [-32700]: "JSON xato",
  [-32600]: "So'rov noto'g'ri",
  [-32601]: "Metod topilmadi",
  [-32400]: "Tizim xatosi",
  [-31001]: "Summa noto'g'ri",
  [-31003]: "Tranzaksiya topilmadi",
  [-31007]: "Bekor qilib bo'lmaydi",
  [-31008]: "Amalni bajarib bo'lmaydi",
  [-31050]: "Buyurtma topilmadi",
  [-31051]: "Buyurtma allaqachon to'langan",
  [-31052]: "Buyurtma yopilgan yoki muddati o'tgan",
  [-31053]: "Buyurtma bo'yicha boshqa to'lov kutilmoqda",
  [-31054]: "Buyurtma cheki tekshirilmoqda",
};

export function reasonText(t: Pick<PaymentTx, "provider" | "reason" | "state">): string | null {
  if (t.reason === null) return t.state === -1 ? "Mijoz yangi urinish boshladi yoki to'lovni tashlab ketdi" : null;
  if (t.provider === "payme") return PAYME_REASON[t.reason] ?? `Payme sababi: ${t.reason}`;
  return CLICK_ERROR[t.reason] ? `Click: ${CLICK_ERROR[t.reason]} (${t.reason})` : `Click xato kodi: ${t.reason}`;
}

/** Holat o'zgargan vaqt: to'langan / bekor qilingan */
export function stateTime(t: Pick<PaymentTx, "state" | "performedAt" | "cancelledAt">): string | null {
  if (t.state === 2) return t.performedAt;
  if (t.state < 0) return t.cancelledAt;
  return null;
}

/** Tarixdagi qadam nomi */
export const EVENT_LABEL: Record<string, string> = {
  CreateTransaction: "To'lov yaratildi (CreateTransaction)",
  PerformTransaction: "To'lov o'tkazildi (PerformTransaction)",
  CancelTransaction: "Bekor qilindi (CancelTransaction)",
  prepare: "Tekshiruv (Prepare)",
  complete: "Yakunlash (Complete)",
};

/** Bizning javob: "ok" yoki xato kodi → tushunarli matn */
export function eventResultText(provider: PaymentTx["provider"], e: PaymentTxEvent): string {
  if (e.result === "ok") return "Muvaffaqiyatli";
  const code = Number(e.result);
  const label = (provider === "payme" ? PAYME_ERROR : CLICK_ERROR)[code];
  return `${label ?? "Xato"} (${e.result})`;
}

/** Payme tiyinda, Click so'mda yuboradi — panelda so'mda */
export function eventAmountSum(provider: PaymentTx["provider"], amount: PaymentTxEvent["amount"]): number | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return provider === "payme" ? n / 100 : n;
}
