/**
 * FAQAT lokal dev: Mini App'ni brauzerda (Telegram'siz) ochish uchun imzolangan initData.
 *   npm run webapp:initdata -- <telegram_id> [ism]
 * Natijani webapp/.env dagi VITE_DEV_INIT_DATA ga yozing. Bu — 24 soat amal qiladigan kirish kaliti, hech kimga bermang.
 */
import { config } from "../config";
import { signInitData } from "../lib/telegramAuth";

if (process.env.NODE_ENV === "production") {
  console.error("Productionda ishlatilmaydi");
  process.exit(1);
}
const [id, name = "Dev"] = process.argv.slice(2);
if (!id || !/^\d{1,15}$/.test(id)) {
  console.error("Foydalanish: npm run webapp:initdata -- <telegram_id> [ism]");
  process.exit(1);
}
const user = JSON.stringify({ id: Number(id), first_name: name, language_code: "uz" });
console.log(signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user }, config.BOT_TOKEN));
