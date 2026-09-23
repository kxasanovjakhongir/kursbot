# Darsliklar savdosi uchun Telegram bot + Admin panel

- **Bot** — TZ v2.1, 2-variant (yarim avtomat): deep link, telefon, video, buyurtma, karta, chek, admin tasdiqlashi, bir martalik kanal linki.
- **Admin panel** — veb-panel: dashboard, foydalanuvchilar, xabarlar tarixi, broadcast, bot buyruqlari va menyusi, sozlamalar, maintenance, adminlar, faoliyat loglari, buyurtmalar.

Stek: Node.js 20+, TypeScript (strict), grammY, Express 5, PostgreSQL + Prisma, JWT + bcrypt · React 19, Vite, Tailwind 4, React Router, Axios, Lucide.

## Tuzilishi

```
src/
  index.ts          bitta jarayon: bot + HTTP server (admin API, webhook, panel fayllari)
  config.ts         .env (zod bilan tekshiriladi)
  services/         biznes logika — Telegram va HTTP dan mustaqil
    orders.ts       buyurtma, status o'tishlari, atomik tasdiqlash
    access.ts       bir martalik link, qo'shilish so'rovi
    broadcast.ts    ommaviy xabar: navbat, 25 xabar/s, 429 da kutish, qayta ishga tushganda davom
    botConfig.ts    buyruqlar va menyu (bazadan)
    panelUsers.ts   panel adminlari (bcrypt)
    activity.ts     faoliyat logi
  bot/
    handlers/       mijoz oqimi, chek, kanalga qo'shilish, bazadagi buyruqlar
    admin/          Telegram'dagi chek kartochkasi, tasdiqlash/rad etish, buyruqlar
    messageLog.ts   kiruvchi/chiquvchi xabarlar tarixi
  api/
    app.ts          Express: helmet, CORS, rate limit, marshrutlar, global xato ushlagich
    auth.ts         JWT, requireAuth, requireSuperAdmin
    routes/         auth, dashboard, bot, commands, menu, telegram-users, messages, broadcast, admins, activity-logs, orders
admin/              React admin panel (Vite)
prisma/             sxema, migratsiyalar, seed
tests/              unit + integratsion (servislar, API)
```

## Rollar

| Imkoniyat | ADMIN | SUPER_ADMIN |
|---|:-:|:-:|
| Dashboard, Telegram foydalanuvchilar, xabarlar, buyurtmalar | ✅ | ✅ |
| Cheklarni tasdiqlash / rad etish (panel yoki Telegram) | ✅ | ✅ |
| Mahsulotlar (narx, tavsif, kanal, tanishtiruv videosi), to'lov kartalari | — | ✅ |
| Broadcast va tarixi | ✅ | ✅ |
| Bot buyruqlari va menyusi | ✅ | ✅ |
| Adminlar, faoliyat loglari | — | ✅ |
| Bot sozlamalari, token, maintenance | — | ✅ |

Ruxsat backendda har bir so'rovda tekshiriladi (`requireSuperAdmin`). Admin roli yoki holati o'zgarsa, keyingi so'rovdanoq kuchga kiradi. Frontend ruxsati yo'q bo'limlarni yashiradi.

> Panel adminlari (email + parol) va Telegram adminlari (chekni tasdiqlaydiganlar, `SUPERADMIN_IDS` / `/addadmin`) — alohida ro'yxatlar.

---

## Ishga tushirish (lokal)

### 1. PostgreSQL

Istalgan PostgreSQL 14+ ishlaydi. Baza yarating:

```bash
createdb darslik_bot          # yoki: psql -c "create database darslik_bot"
```

Parolsiz alohida lokal klaster kerak bo'lsa (mavjud bazaga tegmaydi):

```bash
initdb -D .pgdata -U postgres --auth=trust
pg_ctl -D .pgdata -o "-p 5434 -c unix_socket_directories=''" -l .pgdata/server.log start
psql -h localhost -p 5434 -U postgres -c "create database darslik_bot"
# DATABASE_URL=postgresql://postgres@localhost:5434/darslik_bot
```

### 2. `.env`

```bash
cp .env.example .env
```

Majburiy qiymatlar:

| O'zgaruvchi | Izoh |
|---|---|
| `BOT_TOKEN` (yoki `TELEGRAM_BOT_TOKEN`) | @BotFather dan |
| `SUPERADMIN_IDS` | Sizning Telegram ID ingiz (botdagi super admin) |
| `DATABASE_URL` | PostgreSQL manzili |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `PORT` | HTTP server porti (standart 8080) |
| `CLIENT_URL` | Frontend manzili, CORS uchun (dev: `http://localhost:5173`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Birinchi SUPER_ADMIN (seed yaratadi) |

### 3. Backend: bog'liqliklar, migratsiya, seed

```bash
npm install
npx prisma migrate deploy     # jadvallarni yaratadi
npm run db:seed               # mahsulotlar, bot menyusi, /help /about /contact, birinchi SUPER_ADMIN
```

`ADMIN_PASSWORD` bo'sh bo'lsa, seed tasodifiy parol yaratadi va **bir marta** chop etadi. Kirgandan keyin uni "Profil" sahifasida o'zgartiring.

### 4. Backend va botni ishga tushirish

```bash
npm run dev                   # bot (polling) + API: http://localhost:8080
```

### 5. Frontend (dev)

```bash
npm run admin:install
npm run admin:dev             # http://localhost:5173  (/api → 8080 ga proksi)
```

### 6. Production build (bitta port)

```bash
npm run build:all             # backend → dist/, panel → admin/dist/
npm start                     # panel ham, API ham http://localhost:8080 dan
```

---

## Telegram bot tokeni

1. @BotFather → `/newbot` → tokenni `.env` dagi `BOT_TOKEN` ga yozing.
2. Tokenni keyin panel orqali ham almashtirish mumkin: **Bot sozlamalari → Tokenni yangilash**.
   - Yangi token avval Telegram'da tekshiriladi.
   - U bazada AES-256-GCM bilan shifrlanib saqlanadi va `.env` dagidan ustun turadi.
   - Kuchga kirishi uchun serverni qayta ishga tushirish kerak.
   - Token frontendga hech qachon yuborilmaydi.
3. Kanallar: botni har bir yopiq kanalga admin qiling («foydalanuvchilarni taklif qilish» va «a'zolarni chiqarish» huquqlari bilan).
4. Admin guruhi: guruhga botni qo'shing va u yerda `/setgroup` yozing.

## Polling yoki webhook

| | Polling (lokal, sodda) | Webhook (server) |
|---|---|---|
| `.env` | `BOT_MODE=polling` | `BOT_MODE=webhook`<br>`WEBHOOK_URL=https://domen.uz/telegram`<br>`WEBHOOK_SECRET=<tasodifiy satr>` |
| Talab | Hech narsa | Ochiq HTTPS domen (nginx → `127.0.0.1:8080`) |

Webhook rejimida bot ishga tushganda `setWebhook` ni o'zi chaqiradi. So'rovlar `X-Telegram-Bot-Api-Secret-Token` bilan tekshiriladi. Bir token bilan faqat **bitta** jarayon ishlashi mumkin, aks holda Telegram `409 Conflict` beradi.

## Docker (server)

```bash
# .env: BOT_MODE=webhook, WEBHOOK_URL, WEBHOOK_SECRET, JWT_SECRET, POSTGRES_PASSWORD
docker compose up -d --build
docker compose exec bot node dist/scripts/seed.js   # birinchi marta: SUPER_ADMIN va boshlang'ich ma'lumotlar
```

Konteyner ishga tushganda migratsiyalar avtomatik qo'llanadi. Panel `https://domen.uz/` da ochiladi.

## Botni sozlash (Telegram, super admin)

```
/addcard 8600123412341234 Ism Familiya
/setprice 4b 1250000
/setchannel 4b -1001234567890
(botga video yuboring → mahsulotni tanlang)
/products        ← tekshirish;  /admin ← to'liq ro'yxat
```

Instagram havolalari: `https://t.me/<BOT>?start=4b_reel12` — mahsulot kodi va manba.

## API

Barcha marshrutlar `/api` ostida. `auth/login` dan tashqari hammasi `Authorization: Bearer <JWT>` talab qiladi.

| Metod | Yo'l | Rol |
|---|---|---|
| POST | `/auth/login`, `/auth/logout` · GET `/auth/me` · PUT `/auth/profile`, `/auth/password` | — / hammasi |
| GET | `/dashboard/stats` | hammasi |
| GET | `/bot/status`, `/bot/info` | hammasi |
| GET, PUT | `/bot/settings` · PUT `/bot/maintenance`, `/bot/token` | SUPER_ADMIN |
| GET, POST, PUT, DELETE | `/bot/commands[/:id]` | hammasi |
| GET, POST, PUT, DELETE | `/bot/menu[/:id]` · PUT `/bot/menu/reorder` | hammasi |
| GET | `/telegram-users`, `/telegram-users/:id`, `/telegram-users/:id/messages` | hammasi |
| GET | `/messages` | hammasi |
| POST, GET | `/broadcast` · GET `/broadcast/:id`, `/broadcast/recipients-count` | hammasi |
| GET | `/orders`, `/orders/:id`, `/orders/:id/receipts/:rid/file`, `/orders/pending-count` | hammasi |
| POST | `/orders/:id/approve`, `/orders/:id/reject` | hammasi |
| GET, PUT | `/products[/:id]` · POST, GET, DELETE `/products/:id/video` | SUPER_ADMIN |
| GET, POST, PUT, DELETE | `/cards[/:id]` | SUPER_ADMIN |
| GET, POST, PUT, DELETE | `/admins[/:id]` | SUPER_ADMIN |
| GET | `/activity-logs` | SUPER_ADMIN |

Xatolar har doim `{ "error": "...", "details"?: {...} }` shaklida, mos HTTP status bilan qaytadi.

## Xavfsizlik

- Parollar bcrypt (12 raund) bilan saqlanadi va javoblarga hech qachon chiqmaydi.
- Kirish uchun rate limit: 15 daqiqada 10 urinish. Butun API uchun: daqiqada 300 so'rov.
- JWT HS256 bilan ishlaydi. Foydalanuvchi har so'rovda bazadan qayta o'qiladi, shuning uchun bloklangan admin darhol chiqariladi.
- Barcha kirish ma'lumotlari zod bilan tekshiriladi. SQL injection'dan Prisma parametrlangan so'rovlari himoya qiladi.
- helmet (CSP), CORS faqat `CLIENT_URL` uchun ochiq.
- Chek fayllari server orqali proksi qilinadi, shuning uchun bot tokeni brauzerga chiqmaydi.
- Loglarda telefon va karta raqamlari niqoblanadi.

## Testlar

```bash
npm test                                                      # unit
TEST_DATABASE_URL=postgresql://.../darslik_bot_test npm test  # + integratsion (ALOHIDA baza — jadvallar tozalanadi!)
```

## Bot bosqichlari holati (TZ 14-bo'lim)

| Bosqich | Holat |
|---|---|
| 1. MVP | ✅ |
| 2. Eslatmalar, upsell, promo kod, instrument fayllari, support, SLA | ⏳ |
| 3. Statistika, ommaviy xabar, matnlar, eksport | 🟡 ommaviy xabar, statistika va loglar panelda tayyor; voronka, kunlik hisobot va Excel — keyin |
| 4. Payme / Click | ⏳ merchant ulangandan keyin |
