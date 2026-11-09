import { z } from "zod";
import { SharedState } from "../services/sharedState";

/**
 * Mijoz oxirgi marta qaysi buyurtmaning to'lov oynasini ochgan («Darslikni olaman» yoki «To'lov»).
 * Bir nechta ochiq buyurtma bo'lsa, chek shu buyurtmaga biriktiriladi — bot qaysi darslik ekanini qayta so'ramaydi.
 * Muddat o'tsa yoki buyurtma yopilgan bo'lsa — avvalgidek tugmalar bilan so'raladi.
 */
const lastPayment = new SharedState("lastpay", 24 * 3600_000, z.object({ orderId: z.coerce.bigint() }));

export async function rememberPaymentScreen(telegramId: number, orderId: bigint): Promise<void> {
  await lastPayment.set(telegramId, { orderId });
}

export async function lastPaymentOrderId(telegramId: number): Promise<bigint | null> {
  return (await lastPayment.get(telegramId))?.orderId ?? null;
}
