# Darsliklar savdosi uchun Telegram bot

TZ v2.1, 2-variant (yarim avtomat). Stek: Node.js 20+, TypeScript, grammY, PostgreSQL + Prisma, (2-bosqichdan) Redis + BullMQ.

## Holat

| Bosqich | Holat |
|---|---|
| 1. MVP — deep link va manba, telefon, video, buyurtma, karta, chek, tasdiqlash/rad etish, bir martalik link, qo'shilish so'rovini tekshirish, "Mening xaridlarim" | ✅ tayyor |
| 2. Eslatmalar, upsell, promo kodlar, instrument fayllari, support yozishma, SLA, karta limiti | ⏳ keyingi |
| 3. Statistika, kunlik hisobot, ommaviy xabar, matnlarni tahrirlash, Excel eksport | ⏳ |
| 4. Payme / Click, referal | ⏳ merchant ulanganidan keyin |

Baza sxemasi (10-bo'lim) to'liq qurilgan — keyingi bosqichlar yangi jadval talab qilmaydi.

## Tuzilishi

```
src/
  services/     biznes logika (Telegram'dan mustaqil — 3-variantda Payme/Click ham shuni chaqiradi)
    orders.ts   buyurtma, status o'tishlari (8.1), atomik tasdiqlash (BR-12)
    access.ts   bir martalik link, qo'shilish so'rovi qarori (BR-15/16)
    products.ts, cards.ts, admins.ts, settings.ts, texts.ts, events.ts, users.ts
  bot/
    handlers/   mijoz oqimi (5.1–5.8), chek (5.5), kanalga qo'shilish (5.7)
    admin/      chek kartochkasi (7.2), tasdiqlash/rad etish (7.3), admin buyruqlari
prisma/         sxema, migratsiyalar, seed
tests/          unit + integratsion testlar (T-04, T-07–T-09, T-11, T-14–T-17)
```

## Ishga tushirish (lokal)

1. **Bot**: @BotFather da bot yarating, tokenni oling.
2. **Kanallar**: ikkita yopiq kanal (4 bosqichli, Qoidalar). Botni har biriga admin qiling: «foydalanuvchilarni taklif qilish» va «a'zolarni chiqarish» huquqlari bilan. Kanal sozlamalarida «kontentni saqlashni cheklash»ni yoqing (BR-17).
3. **Admin guruhi**: yopiq guruh yarating, botni qo'shing (xabar yozish huquqi bilan).
4. `.env`:
   ```bash
   cp .env.example .env   # BOT_TOKEN, SUPERADMIN_IDS, DATABASE_URL ni to'ldiring
   ```
5. Baza:
   ```bash
   npm install
   npx prisma migrate deploy
   npm run db:seed        # 4b, qd, bundle mahsulotlari
   ```
6. Ishga tushirish: `npm run dev` (polling rejimi).
7. Botda sozlash (super admin):
   ```
   /setgroup                          ← admin guruhida yozing
   /addcard 8600123412341234 Aziz Karimov
   /setprice 4b 1250000
   /setchannel 4b -1001234567890
   /setdesc 4b Darslik haqida qisqa tavsif
   (botga video yuboring → mahsulotni tanlang)
   /products                          ← hammasi to'g'riligini tekshiring
   ```
   To'liq ro'yxat: `/admin`.

## Instagram havolalari

`https://t.me/<BOT>?start=<mahsulot>_<manba>` — masalan `4b_reel12`, `qd_bio`, `4b_stories3`. Manba birinchi kirishda saqlanadi (first-touch) va har bir buyurtmaga yoziladi. Parametrsiz START — mahsulotlar ro'yxati.

## Server (Docker)

```bash
# .env da: BOT_MODE=webhook, WEBHOOK_URL=https://domen/telegram, WEBHOOK_SECRET=<tasodifiy>
docker compose up -d --build
```
nginx HTTPS ni `127.0.0.1:8080` ga proksi qiladi. Migratsiyalar konteyner ishga tushganda avtomatik qo'llanadi.

## Testlar

```bash
npm test                                            # unit testlar
TEST_DATABASE_URL=postgresql://.../bot_test npm test  # + integratsion (ALOHIDA test bazasi — jadvallar tozalanadi!)
```

## MVP dagi soddalashtirishlar

- Muddati o'tgan buyurtmalar (BR-02) mijoz bot bilan ishlaganda yopiladi; "buyurtma yopildi" xabari va eslatmalar 2-bosqichda BullMQ bilan.
- "Savol berish" / "Admin bilan bog'lanish" hozircha `SUPPORT_USERNAME` ga olib boradi; bot ichidagi support yozishma (7.4) — 2-bosqich.
- Admin sozlamalari hozircha buyruqlar orqali; menyuli interfeys 3-bosqichda.
