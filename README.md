# Darsliklar savdosi uchun Telegram bot + Admin panel

- **Bot** — TZ v2.1, 2-variant (yarim avtomat): deep link, telefon, tanishtiruv video, buyurtma, karta, chek, admin tasdiqlashi, bir martalik kanal linki, kurs darslari (video, Telegram `file_id`). Yordam, botning o'zidagi admin panel; 3 til (uz/ru/en).
- **Admin panel** — veb-panel: dashboard, foydalanuvchilar, xabarlar tarixi, broadcast, bot buyruqlari va menyusi, sozlamalar, maintenance, adminlar, faoliyat loglari, buyurtmalar.

Stek: Node.js 20+, TypeScript (strict), grammY, Express 5, PostgreSQL + Prisma, JWT + bcrypt · React 19, Vite, Tailwind 4, React Router, Axios, Lucide.

## Tuzilishi

```
src/
  index.ts          bitta jarayon: bot + HTTP server (admin API, webhook, panel fayllari)
  config.ts         .env (zod bilan tekshiriladi, xato bo'lsa qiymatlarsiz tushunarli ro'yxat)
  i18n/             matnlar: locales/uz.ts (asosiy), ru.ts, en.ts — kalitlar TypeScript bilan majburiy
  services/         biznes logika — Telegram va HTTP dan mustaqil
    orders.ts       buyurtma, status o'tishlari, atomik tasdiqlash, mijoz bekor qilishi
    access.ts       bir martalik link, qo'shilish so'rovi
    permissions.ts  rollar va ruxsatlar jadvali (bot va API uchun yagona manba)
    users.ts        foydalanuvchi (kam yozuvli touchUser), til, cheklash, statistika
    stats.ts        dashboard statistikasi (panel va botdagi admin uchun umumiy)
    notifications.ts bildirishnomalar tarixi
    broadcast.ts    ommaviy xabar: auditoriyalar, navbat, 25 xabar/s, 429 da kutish, qayta ishga tushganda davom
    botConfig.ts    buyruqlar va menyu (bazadan)
    panelUsers.ts   panel adminlari (bcrypt)
    activity.ts     faoliyat logi
  bot/
    bot.ts          middleware tartibi va handlerlar ulanishi
    context.ts      BotContext: user, admin, role, lang, t(), label(), log
    middleware/     requestLog, errorBoundary, autoAnswer, throttle, identify, accessGuard
    ui/             render (ekranni joyida tahrirlash, loading, pagination), callback nomlari
    screens/        ekranlar: home, catalog (darslik, to'lov), lessons (kurs darslari), account (profil, sozlamalar, til, yordam, bildirishnomalar), admin
    handlers/       mijoz oqimi, navigatsiya, chek, kanalga qo'shilish, bazadagi buyruqlar
    admin/          chek kartochkasi, tasdiqlash/rad etish, admin buyruqlari, inline admin panel
    keyboards.ts    pastki menyu, navigatsiya (⬅️ Orqaga / 🏠 Bosh menyu), pagination
    messageLog.ts   kiruvchi/chiquvchi xabarlar tarixi
  api/
    app.ts          Express: helmet, CORS, rate limit, marshrutlar (har biri o'z ruxsati bilan), global xato ushlagich
    auth.ts         JWT, requireAuth, requirePermission
    routes/         auth, dashboard, bot, commands, menu, telegram-users, messages, broadcast, admins, activity-logs, errors, orders
admin/              React admin panel (Vite) — xodimlar uchun (email + parol)
prisma/             sxema, migratsiyalar, seed
tests/              unit (i18n, rollar, yordamchilar) + integratsion (servislar, API, bot oqimlari)
```

## Bot (foydalanuvchi uchun)

Pastki menyu: **📚 Darsliklar · 💬 Yordam**. Adminlarda qo'shimcha **🛠 Admin panel** tugmasi bor (boshqalarga ko'rinmaydi, qo'lda yozilsa — rad javobi).

- Inline tugmalar bosilganda yangi xabar yuborilmaydi, o'sha xabar tahrirlanadi. Har bir ichki ekranda **⬅️ Orqaga** va **🏠 Bosh menyu** tugmalari bor. Ro'yxatlar sahifalarga bo'lingan (◀️ 1/3 ▶️).
- To'lov ma'lumoti alohida xabar bo'lib keladi. Unda karta raqamini bir bosishda nusxalash va buyurtmani **tasdiqlash oynasi orqali** bekor qilish mumkin.
- Profilda: ism, username, Telegram ID, telefon (yangilash mumkin), til, ro'yxatdan o'tgan sana, darsliklar, buyurtmalar va jami to'lov soni. Bildirishnomalar tarixi ham shu yerda.
- Sozlamalarda: til (🇺🇿/🇷🇺/🇬🇧) va yangiliklarni o'chirish. Buyurtma bo'yicha xabarlar har doim yuboriladi.
- Og'ir ekranlar ochilayotganda "⏳ Ma'lumotlar yuklanmoqda..." ko'rinadi. Noma'lum buyruq, eskirgan tugma, xato, spam yoki cheklov bo'lsa, foydalanuvchi o'z tilida tushunarli xabar oladi. Texnik tafsilotlar faqat logga va `TECH_CHAT_ID` ga yoziladi.
- Buyruqlar: `/start`, `/menu`, `/profile`, `/settings`, `/help`. Paneldagi bir xil nomli buyruq ustun turadi.

**Matnlar** `src/i18n/locales/*.ts` fayllarida saqlanadi. Yangi til qo'shish uchun `Messages` typida fayl yarating va uni `LANGS` ga qo'shing. Biror kalit tushib qolsa, TypeScript xato beradi. Testlar esa `{o'zgaruvchilar}` va HTML teglari barcha tillarda bir xilligini tekshiradi. `texts` jadvali (`key`, `lang`) matnni bazadan ustidan yozishga imkon beradi. Foydalanuvchi tili = u tanlagan til, tanlamagan bo'lsa paneldagi "Standart til".

## Kurs oqimi

```
📚 Darsliklar → kurs → 🎥 tanishtiruv videosi (izohida tavsif va narx) → ✅ Darslikni olaman
→ to'lov (karta) → chek → admin tasdiqlaydi → "To'lov muvaffaqiyatli" + 📚 Kursni boshlash → darslar
```

- **Tanishtiruv videosi** (`products.video_file_id`) — ochiq: kursni sotib olmaganlar ham ko'radi. Panel → Mahsulotlar → video.
- **Kurs darslari** (`lessons`) — faqat faol kirishi (`access_grants`) bor xaridorga yuboriladi. Sotib olmaganlar dars nomlarini 🔒 bilan ko'radi.
- Sotib olingan kurs sahifasida: darslar ro'yxati va **🔗 Kanal havolasi** (yopiq kanal linkini qayta olish).
- Sotuvdan olingan kurs xaridorlarning katalogida ✅ bilan qoladi.

## Kampaniya linklari (reklama deep link)

Admin panel → **Kampaniya linklari** (ADMIN va SUPER_ADMIN). Link uchun darslik, manba (instagram, tiktok…), medium (story, reels…) va kampaniya tanlanadi. Kod ikki xil bo'lishi mumkin:
- avtomatik qisqa kod, masalan `c7k2m9x`;
- admin bergan kod, masalan `frontend-sep`.

| Havola | Natija |
|---|---|
| `t.me/<bot>` | Oddiy salomlashuv va barcha darsliklar |
| `t.me/<bot>?start=c7k2m9x` | Bot "… darsligiga xush kelibsiz!" deydi va **faqat shu darslikni** ko'rsatadi |
| Noto'g'ri, o'chirilgan link yoki nofaol darslik | "Bu havola noto'g'ri yoki eskirgan" va umumiy katalog |

- **Kodni aniqlash:** kod faqat backend'da, bazadan aniqlanadi.
- **Eski format:** `4b_instagram` ko'rinishidagi linklar avvalgidek ishlaydi.
- **Statistika:**
  - kirishlar: bir foydalanuvchining 30 daqiqa ichidagi takroriy bosishi bittaga hisoblanadi;
  - foydalanuvchilar va yangi foydalanuvchilar;
  - buyurtmalar va to'lovlar, tushum;
  - konversiya = to'lov qilganlar / link orqali kelgan foydalanuvchilar.
- **Buyurtmani bog'lash:** buyurtma foydalanuvchi oxirgi marta bosgan linkka yoziladi, agar u 30 kun ichida bosilgan bo'lsa (`orders.link_id`).
- **O'chirish:** statistikasi bor link o'chirilmaydi, faqat faolsizlantiriladi.

**Tracking link (bosishlar):** reklamaga `https://<PUBLIC_URL>/l/<kod>` qo'ying. U bosishni yozadi (IP saqlanmaydi, faqat kunlik hash) va `t.me/<bot>?start=<kod>` ga yo'naltiradi. Telegram `t.me` bosilganini botga bildirmaydi, shuning uchun "Link bosildi" bosqichi faqat shu link orqali ko'rinadi.

**Analitika** (panel → Analitika, ADMIN va SUPER_ADMIN): davr filtri (Bugun, Kecha, 7 kun, 30 kun, Shu oy, Oraliq) bilan quyidagilar ko'rinadi:
- KPI: foydalanuvchilar, leadlar, xaridlar, daromad, konversiya;
- funnel: bosish → botga kirish → ro'yxatdan o'tish (telefon) → kursni ko'rish → buyurtma → xarid;
- kunlik grafiklar: foydalanuvchilar, xaridlar, daromad;
- kurslar, manbalar va "kurs × manba × kampaniya" jadvallari.

Barcha sonlar unique foydalanuvchi bo'yicha (Telegram ID). Takroriy `/start` yangi foydalanuvchi hisoblanmaydi. Birinchi manba (first-touch) `users.first_link_id` va `first_source` da o'zgarmay saqlanadi, buyurtma esa oxirgi linkka yoziladi (last-touch, 30 kun).

**Kurs ma'lumotlari:** davomiyligi, darslar soni, boshlanish sanasi, kimlar uchun, afzalliklari, dastur, o'qituvchi (Mahsulotlar → tahrirlash). To'ldirilgan bo'limlar uchun botda "📚 Kurs haqida / 💰 Narxi / 🎓 Dastur / 👨‍🏫 O'qituvchi" tugmalari chiqadi.

## Rollar

Ruxsatlar bitta jadvalda saqlanadi (`src/services/permissions.ts`). Bot (`can(ctx.role, ...)`) ham, API (`requirePermission(...)`) ham shu jadvaldan foydalanadi.

| Imkoniyat | USER | ADMIN | SUPER_ADMIN |
|---|:-:|:-:|:-:|
| Darsliklar, kurs darslari, profil, sozlamalar, yordam | ✅ | ✅ | ✅ |
| Dashboard/statistika, Telegram foydalanuvchilar, xabarlar, buyurtmalar | — | ✅ | ✅ |
| Cheklarni tasdiqlash / rad etish (panel yoki Telegram), cheklar tarixi, buyurtmani bekor qilish | — | ✅ | ✅ |
| Foydalanuvchini cheklash/tiklash, shaxsiy xabar | — | ✅ | ✅ |
| Broadcast va tarixi, bot buyruqlari va menyusi | — | ✅ | ✅ |
| Mahsulotlar (narx, tavsif, kanal, video), to'lov kartalari | — | — | ✅ |
| Adminlar, faoliyat loglari, xatoliklar, bot sozlamalari, token, maintenance | — | — | ✅ |

Ruxsat backendda har bir so'rovda, botda esa har bir update'da qayta tekshiriladi. Admin roli yoki holati o'zgarsa, keyingi so'rovdanoq kuchga kiradi. Frontend ruxsati yo'q bo'limlarni yashiradi.

> Panel adminlari (email + parol) va Telegram adminlari (chekni tasdiqlaydiganlar, `SUPERADMIN_IDS` / `/addadmin`) — alohida ro'yxatlar, rollari bir xil.
>
> **Panel admini botda ham:** Adminlar sahifasida adminga **Telegram ID** berilsa, o'sha odam botda ham xuddi shu rol bilan admin bo'ladi va unga botda xabar keladi. Panelda rol o'zgarsa, admin bloklansa, o'chirilsa yoki ID olib tashlansa, botdagi huquq ham shunga moslanadi. `.env` dagi super adminlarga bu tegmaydi.
>
> **Botda adminlarni boshqarish** (SUPER_ADMIN): 🛠 Admin panel → 👥 Adminlar.
> - **Qo'shish:** Telegram ID ni yozish, «👤 Foydalanuvchini tanlash» (Telegram oynasi) yoki kontakt yuborish, keyin rol tanlanadi.
> - **O'zgartirish:** admin ustiga bosib rolni almashtirish yoki adminlikdan olish.
> - **Himoya:** `.env` dagi super adminlar va o'zingiz o'zgartirilmaysiz, kamida bitta super admin doim qoladi.

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
npm start                     # panel (/), API (/api) — http://localhost:8080
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
   - **Kirish muddati:** mahsulotda «Kanalda qolish muddati (kun)» berilsa, har bir yangi xaridga muddat qo'yiladi; foydalanuvchi sahifasida muddatni uzaytirish, muddatsiz qilish, kanaldan chiqarish yoki tiklash mumkin. Bot har 5 daqiqada tekshiradi: muddat tugashidan 3 kun oldin eslatma yuboradi, tugaganda kanaldan chiqaradi. «A'zolarni chiqarish» huquqi bo'lmasa, chiqarish keyingi tekshiruvda qayta uriniladi.
   - **Cheklash:** paneldagi «Cheklash» foydalanuvchini yopiq kanallardan ham chiqaradi (tanlov bilan); cheklov olib tashlansa, kirishlar tiklanadi va link botdagi kurs sahifasidan («🔗 Kanal havolasi») olinadi.
4. Admin guruhi: guruhga botni qo'shing va u yerda `/setgroup` yozing.

## Deploy (production)

To'liq qo'llanma: **[deploy/DEPLOY.md](deploy/DEPLOY.md)**. Unda server tayyorlash, TLS, birinchi deploy, yangilash, rollback, backup/restore va monitoring bor.

| Fayl | Vazifasi |
|---|---|
| `Dockerfile` | Kichik image, root emas (`node`), `tini`, HEALTHCHECK. Migratsiya alohida `migrate` target'ida |
| `docker-compose.yml` | `app` + `db` (Redis yo'q). Parollar majburiy, log rotation, xotira limitlari, faqat `127.0.0.1` |
| `deploy/nginx/darslik-bot.conf` | TLS, webhook faqat Telegram IP'laridan, body limitlari, IP bo'yicha rate limit, JSON access log |
| `deploy/deploy.sh` | Build → backup → migratsiya → almashtirish → `/ready` → smoke. Muvaffaqiyatsiz bo'lsa avtomatik rollback |
| `deploy/rollback.sh` | Oldingi image'ga qaytish (qayta build qilinmaydi) |
| `deploy/backup.sh`, `deploy/restore.sh` | `pg_dump` + yaroqlilik tekshiruvi + ixtiyoriy shifrlash/offsite; `--test` — vaqtinchalik bazaga tiklab tekshirish |
| `.github/workflows/deploy.yml` | Qo'lda ishga tushiriladi: to'liq CI, keyin SSH orqali `deploy.sh` |

## Polling yoki webhook

| | Polling (lokal, sodda) | Webhook (server) |
|---|---|---|
| `.env` | `BOT_MODE=polling` | `BOT_MODE=webhook`<br>`WEBHOOK_URL=https://domen.uz/telegram`<br>`WEBHOOK_SECRET=<tasodifiy satr>` |
| Talab | Hech narsa | Ochiq HTTPS domen (nginx → `127.0.0.1:8080`) |

Webhook rejimida bot ishga tushganda `setWebhook` ni o'zi chaqiradi. So'rovlar `X-Telegram-Bot-Api-Secret-Token` bilan tekshiriladi.

**Qaysi birini tanlash:**
- **Bitta server:** polling yetarli. Update'lar parallel qayta ishlanadi (`@grammyjs/runner`, `BOT_CONCURRENCY`) va bitta chat ichidagi tartib saqlanadi. Ochiq port yoki domen kerak emas.
- **Bir nechta server (horizontal scaling):** faqat **webhook**. Telegram bir token uchun faqat bitta `getUpdates` ga ruxsat beradi, ikkinchisi `409 Conflict` oladi. Load balancer update'larni instanslarga taqsimlaydi.
- **Webhook timeout:** handler 9 soniyadan uzoq ishlasa ham Telegram'ga darhol 200 qaytariladi. Aks holda Telegram update'ni qayta yuborardi.

## Production: masshtab, monitoring, to'xtatish

**Bir nechta instans.** Barcha umumiy holat PostgreSQL'da, Redis shart emas:
- **Suhbat holatlari** (`bot_state`): chekni buyurtmaga biriktirish, rad etish sababini kiritish, video.
- **Fon vazifalari** (`job_locks` lease): broadcast, kanal muddatlari, tozalash. Bir vaqtda faqat bitta instans bajaradi. U o'lsa, lease tugagach boshqasi davom ettiradi.
- **Broadcast media:** oldindan Telegram'ga yuklanadi (`file_id`), shuning uchun istalgan instans yuboradi.
- **Takroriy update:** to'lov, buyurtma va chek oqimlari idempotent. Status o'tishlari atomik (`UPDATE … WHERE status IN`), qisman unique indeks va `idempotencyKey` ishlatiladi.
- **Instansda qoladigan narsalar:** spam limiti va rate limit (taxminiy). Ularni aniq qilish uchun keyinchalik Redis store qo'shish mumkin.

**Baza ulanishlari:** `DB_POOL_SIZE × instanslar soni < max_connections`. Ko'p instans uchun PgBouncer (transaction mode) tavsiya etiladi, bunda `DATABASE_URL` ga `?pgbouncer=true` qo'shiladi.

**Probe'lar va metrikalar:**

| Endpoint | Maqsad |
|---|---|
| `GET /health` | Liveness: jarayon tirik |
| `GET /ready` | Readiness: baza javob beradi, bot ishlayapti, to'xtatilmayapti (aks holda 503) |
| `GET /metrics` | Prometheus, `Authorization: Bearer $METRICS_TOKEN` (token bo'lmasa 404) |

Asosiy metrikalar:
- `bot_updates_total{type,status}`, `bot_update_duration_seconds`, `bot_updates_in_flight`;
- `telegram_api_calls_total{method,result}`: 429 va 403 xatolari shu yerda ko'rinadi;
- `http_requests_total`, `http_request_duration_seconds`, `db_query_duration_seconds`, `job_runs_total{job,result}`;
- `app_active_users_15m`, `app_broadcast_queue_pending`, `app_pending_receipts`;
- standart jarayon metrikalari: CPU, RAM, event loop lag, GC.

Har bir HTTP javobda `X-Request-Id` bor, loglar JSON (pino). Token, parol, telefon va karta raqami loglarda `***` bilan niqoblanadi.

**Graceful shutdown (SIGTERM/SIGINT):** quyidagi tartibda bajariladi. `SHUTDOWN_TIMEOUT_MS` dan oshsa, jarayon majburan chiqadi.
1. `/ready` → 503.
2. Yangi update'lar to'xtaydi, joriylari tugaydi.
3. Broadcast joriy xabardan keyin to'xtaydi. Holat bazada qoladi va keyin davom etadi.
4. Xabarlar logi buferi yoziladi.
5. HTTP server yopiladi, keyin baza ulanishlari.

**Load test:** faqat test bazasida ishga tushiring.

```bash
DATABASE_URL=postgresql://.../darslik_bot_test npm run loadtest -- bot  --users 10000 --rate 500 --duration 10 --concurrency 100
DATABASE_URL=postgresql://.../darslik_bot_test npm run loadtest -- http --users 1000 --concurrency 100 --requests 10000
```

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
| GET | `/telegram-users` (`status=all\|active\|blocked\|banned`), `/telegram-users/:id`, `/telegram-users/:id/messages` | hammasi |
| POST | `/telegram-users/:id/ban`, `/telegram-users/:id/unban`, `/telegram-users/:id/message` | hammasi |
| GET | `/messages` | hammasi |
| POST, GET | `/broadcast` · GET `/broadcast/:id`, `/broadcast/recipients-count`, `/broadcast/products` | hammasi |
| GET | `/orders`, `/orders/:id`, `/orders/:id/receipts/:rid/file`, `/orders/pending-count`, `/orders/receipts/history` (`result=all\|approved\|rejected\|cancelled`, `q`) | hammasi |
| POST | `/orders/:id/approve`, `/orders/:id/reject`, `/orders/:id/cancel` (ochiq → bekor qilingan; to'langan → pul qaytarilgan + kanaldan chiqarish) | hammasi |
| GET, POST, PUT, DELETE | `/products[/:id]` (buyurtmasi bor kurs "yumshoq" o'chiriladi — tarix saqlanadi) · POST, GET, DELETE `/products/:id/video` | SUPER_ADMIN |
| GET, POST, PUT, DELETE | `/cards[/:id]` | SUPER_ADMIN |
| GET, POST, PUT, DELETE | `/admins[/:id]` | SUPER_ADMIN |
| GET | `/activity-logs` | SUPER_ADMIN |
| GET | `/errors` (`status=open\|resolved\|all`, `q`), `/errors/count`, `/errors/:id` · POST `/errors/:id/resolve`, `/errors/:id/reopen`, `/errors/resolve-all` · DELETE `/errors/resolved` | SUPER_ADMIN |

Xatolar har doim `{ "error": "...", "details"?: {...} }` shaklida, mos HTTP status bilan qaytadi.

**Broadcast auditoriyalari:** `all`, `active` (botni bloklamaganlar), `buyers` (tasdiqlangan xaridi borlar), `non_buyers`, `product` (+ `productId`, shu darslik egalari), `admins` (Telegram adminlari), `specific` (ID yoki @username). Cheklangan foydalanuvchilar hech qachon xabar olmaydi. Yangiliklarni o'chirganlar ommaviy auditoriyalardan chiqariladi, lekin nomma-nom tanlanganda xabar oladi. Natija: jami / yuborildi / xato / o'tkazib yuborildi.

## Xavfsizlik

- Parollar bcrypt (12 raund) bilan saqlanadi va javoblarga hech qachon chiqmaydi.
- Kirish uchun rate limit: 15 daqiqada 10 urinish. Butun API uchun: daqiqada 300 so'rov.
- JWT HS256 bilan ishlaydi. Foydalanuvchi har so'rovda bazadan qayta o'qiladi, shuning uchun bloklangan admin darhol chiqariladi.
- Barcha kirish ma'lumotlari zod bilan tekshiriladi. SQL injection'dan Prisma parametrlangan so'rovlari himoya qiladi.
- helmet (CSP), CORS faqat `CLIENT_URL` uchun ochiq.
- Chek fayllari server orqali proksi qilinadi, shuning uchun bot tokeni brauzerga chiqmaydi.
- Loglar JSON formatida (pino, ISO vaqt). Har bir update logida `updateId`, `userId`, `chatId`, tur, buyruq yoki callback va davomiylik bor. Foydalanuvchi yozgan matn logga tushmaydi. Telefon, karta raqami, token, parol va `authorization` niqoblanadi.
- Botda spam himoyasi bor: 10 soniyada 20 tadan ortiq update kelsa, ortiqchasi bazaga tegmasdan tashlanadi va foydalanuvchi bir marta ogohlantiriladi. Cheklangan foydalanuvchiga bot javob bermaydi.
- Callback ma'lumotlari regex bilan tekshiriladi (ID uzunligi cheklangan). Foydalanuvchi faqat o'z buyurtmasini ko'ra oladi va bekor qila oladi.

## Testlar

```bash
npm run typecheck && npm run lint
npm test                                                      # unit
TEST_DATABASE_URL=postgresql://.../darslik_bot_test npm test  # + integratsion (ALOHIDA baza — jadvallar tozalanadi!)
```

Bot testlari (`tests/bot.test.ts`) soxta Telegram API orqali haqiqiy update'larni `bot.handleUpdate` ga beradi. Tekshiriladigan oqimlar: /start, telefon, profil, til, buyurtma va uni bekor qilish, pagination, admin paneli va ruxsatlar, cheklov, maintenance, xato holatlari, spam himoyasi.

## Bot bosqichlari holati (TZ 14-bo'lim)

| Bosqich | Holat |
|---|---|
| 1. MVP | ✅ |
| 2. Eslatmalar, upsell, promo kod, instrument fayllari, support, SLA | ⏳ |
| 3. Statistika, ommaviy xabar, matnlar, eksport | 🟡 ommaviy xabar, statistika va loglar panelda tayyor; voronka, kunlik hisobot va Excel — keyin |
| 4. Payme / Click | ⏳ merchant ulangandan keyin |
