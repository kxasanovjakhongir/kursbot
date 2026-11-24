import { Api } from "grammy";
import { prisma } from "../db";
import { resolveBotToken } from "../services/botToken";
import { sendRemindersNow } from "../services/reminders";

/**
 * Eslatmalarni hozir yuborish (soat 09:00–22:00 cheklovisiz), har kimga o'z bosqichiga mos bitta:
 *   docker exec darslik-bot-app-1 node dist/scripts/sendReminders.js
 */
async function main(): Promise<void> {
  const { token } = await resolveBotToken();
  const result = await sendRemindersNow(new Api(token));
  console.log(result ? `yuborildi: to'lov ${result.pay}, video/raqam ${result.phone}, «darslikni oling» ${result.upsell}` : "fon vazifasi hozir ishlayapti — birozdan keyin qayta urinib ko'ring");
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
