# Production deploy (Ubuntu 24.04 LTS, bitta server)

Arxitektura: **Telegram → Nginx (TLS) → app konteyneri (bot webhook + API + panel) → PostgreSQL konteyneri**.
Redis/queue yo'q (kerak emas — navbat, qulf va umumiy holat PostgreSQL da; yuklama testi: 1000+ update/s).

Minimal server: **2 vCPU, 2–4 GB RAM, 40 GB SSD**. Domen A-yozuvi server IP siga yo'naltirilgan bo'lsin.

> Hamma buyruqlar serverda. `bot.example.uz` — o'z domeningiz, `deploy` — ishlaydigan foydalanuvchi.

## 0. Oldindan (noutbukda)
Kod git'da bo'lishi shart — deploy faqat commit qilingan versiyadan ishlaydi:
```bash
git add -A && git commit -m "Production tayyorgarlik"
git remote add origin git@github.com:<siz>/<repo>.git   # xususiy (private) repo
git push -u origin master
git tag v1.0.0 && git push --tags
```

## 1. Serverni tayyorlash (bir marta, root)
```bash
apt update && apt -y full-upgrade
apt -y install ca-certificates curl git ufw fail2ban unattended-upgrades nginx certbot
dpkg-reconfigure -f noninteractive unattended-upgrades        # xavfsizlik yangilanishlari avtomatik

# Ishlaydigan foydalanuvchi (root emas), faqat SSH kalit bilan
adduser --disabled-password --gecos "" deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/ && chown deploy:deploy /home/deploy/.ssh/authorized_keys

# SSH: parol va root orqali kirish o'chiriladi (avval deploy bilan kira olishingizni tekshiring!)
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/; s/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl reload ssh

# Firewall: faqat SSH, HTTP, HTTPS. 8080 (app) va 5432 (baza) TASHQARIGA OCHILMAYDI
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban                                 # SSH brute force himoyasi (standart jail yetarli)

# Docker (rasmiy repo)
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt update && apt -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
usermod -aG docker deploy          # diqqat: docker guruhi = root darajasidagi huquq; bu foydalanuvchini faqat deploy uchun ishlating

# Papkalar
install -d -o deploy -g deploy -m 750 /srv/darslik-bot /var/backups/darslik-bot
```
Docker konteynerlarni `ufw` dan o'tkazib port ochishi mumkin — shuning uchun compose da portlar faqat `127.0.0.1` ga bog'langan (tashqaridan ochilmaydi).

## 2. Kod va sozlamalar (deploy foydalanuvchisi)
```bash
su - deploy
git clone git@github.com:<siz>/<repo>.git /srv/darslik-bot && cd /srv/darslik-bot
cp .env.production.example .env.production && chmod 600 .env.production
nano .env.production    # BOT_TOKEN, SUPERADMIN_IDS, domen, va quyidagi secret'lar:
for v in POSTGRES_PASSWORD WEBHOOK_SECRET JWT_SECRET ENCRYPTION_KEY METRICS_TOKEN; do echo "$v=$(openssl rand -hex 24)"; done
```
`.env.production` hech qachon git'ga tushmaydi (`.gitignore`), image ichiga ham kirmaydi (`.dockerignore`).

## 3. TLS va Nginx (root)
```bash
cp /srv/darslik-bot/deploy/nginx/darslik-bot.conf /etc/nginx/sites-available/darslik-bot
sed -i 's/bot.example.uz/SIZNING-DOMEN/g' /etc/nginx/sites-available/darslik-bot
mkdir -p /var/www/certbot
# Sertifikat olish uchun avval faqat 80-port bloki kerak: vaqtincha standart sayt bilan
certbot certonly --webroot -w /var/www/certbot -d SIZNING-DOMEN --agree-tos -m siz@email.uz --no-eff-email \
  || certbot certonly --standalone -d SIZNING-DOMEN --pre-hook "systemctl stop nginx" --post-hook "systemctl start nginx"
ln -sf /etc/nginx/sites-available/darslik-bot /etc/nginx/sites-enabled/darslik-bot
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
systemctl list-timers | grep certbot     # avtomatik yangilanish (certbot.timer)
```

## 4. Birinchi deploy (deploy foydalanuvchisi)
```bash
cd /srv/darslik-bot
deploy/deploy.sh v1.0.0            # build → (birinchi marta backup o'tkaziladi) → migratsiya → app → /ready → smoke
docker compose --env-file .env.production run --rm app node dist/scripts/seed.js   # birinchi SUPER_ADMIN (parol chop etiladi)
```
Webhook ni ilova o'zi o'rnatadi (`setWebhook` + secret). Smoke test `getWebhookInfo` ni tekshiradi.
Telegram'da botga `/start` yozing — javob kelishi kerak.

## 5. Keyingi versiyalar (minimal downtime)
```bash
cd /srv/darslik-bot && git fetch --tags && deploy/deploy.sh v1.1.0
```
- Avval yangi image yig'iladi (eski versiya ishlab turadi), backup olinadi, migratsiya qo'llanadi, keyin konteyner almashtiriladi.
- Uzilish: bir necha soniya (eski konteyner graceful to'xtaydi). Telegram shu vaqtdagi update larni saqlab, qayta yuboradi — yo'qolmaydi.
- `/ready` 90 soniyada kelmasa — **avtomatik rollback** oldingi versiyaga.
- GitHub'dan: Actions → **Deploy** (avval to'liq CI, keyin SSH orqali shu skript). Secretlar: `SSH_HOST, SSH_USER, SSH_KEY, SSH_KNOWN_HOSTS, APP_DIR`.

## 6. Rollback
```bash
deploy/rollback.sh                    # oldingi versiya (.deploy/previous)
deploy/rollback.sh 3f2a9c1b7d4e       # aniq versiya — mavjudlari: docker image ls darslik-bot
cat .deploy/history                   # deploy tarixi
```
**Migratsiyalar qaytarilmaydi.** Qoida: migratsiyalar faqat qo'shuvchi (yangi jadval/ustun, nullable yoki default bilan) —
eski kod yangi sxemada ishlaydi, shuning uchun image rollback xavfsiz. Ustun o'chirish/nomini o'zgartirish kerak bo'lsa —
ikki relizda: (1) kod eski ustunni ishlatmay qo'yadi, (2) keyingi relizda ustun o'chiriladi.
Ma'lumot buzilgan bo'lsa — `deploy/restore.sh` (quyida).

## 7. Backup va tiklash
```bash
# Cron (deploy foydalanuvchisi: crontab -e)
15 3 * * *  cd /srv/darslik-bot && deploy/backup.sh >> /var/backups/darslik-bot/backup.log 2>&1
# Har yakshanba — backup haqiqatan tiklanishini tekshirish (vaqtinchalik bazaga)
30 4 * * 0  cd /srv/darslik-bot && deploy/restore.sh --test "$(ls -t /var/backups/darslik-bot/*.dump* | head -1)" >> /var/backups/darslik-bot/restore-test.log 2>&1
```
- Chastota: har kuni + har deploydan oldin. Saqlash: 14 kun (`RETENTION_DAYS`).
- **Server diskidagi backup yetarli emas** (server yo'qolsa backup ham yo'qoladi): `BACKUP_RCLONE_REMOTE` (S3/Backblaze/Google Drive) va shifrlash uchun `BACKUP_GPG_RECIPIENT` (ochiq kalit serverda, maxfiy kalit — serverdan tashqarida) bering.
- Tiklash (production bazani almashtiradi, oldin xavfsizlik backup'i olinadi):
  ```bash
  CONFIRM=ha deploy/restore.sh /var/backups/darslik-bot/darslik_bot_20260101T031500Z.dump
  ```

## 8. Monitoring va loglar
```bash
docker compose --env-file .env.production ps                     # holat va healthcheck
docker compose --env-file .env.production logs -f --tail=200 app # loglar (JSON, pino)
docker compose --env-file .env.production logs app | grep '"level":50'    # faqat xatolar (50=error, 60=fatal)
curl -s 127.0.0.1:8080/ready                                     # baza + bot holati
curl -s -H "Authorization: Bearer $METRICS_TOKEN" 127.0.0.1:8080/metrics | grep -E '^(bot_updates_total|http_requests_total|app_)'
docker stats --no-stream                                         # CPU/RAM konteynerlar bo'yicha
df -h / /var/lib/docker; du -sh /var/backups/darslik-bot         # disk
tail -f /var/log/nginx/darslik-bot.access.log                    # HTTP (JSON, request ID bilan)
```
Tavsiya etilgan ogohlantirishlar (Prometheus/Grafana yoki UptimeRobot kabi tashqi tekshiruv `https://domen/ready`):
- `/ready` 2 daqiqa 200 bermasa;
- `rate(bot_updates_total{status="error"}[5m]) / rate(bot_updates_total[5m]) > 0.05`;
- `rate(telegram_api_calls_total{result="error_429"}[5m]) > 0` uzoq vaqt;
- `histogram_quantile(0.95, rate(bot_update_duration_seconds_bucket[5m])) > 2`;
- disk > 80%, `app_pending_receipts` uzoq vaqt o'smoqda, `job_runs_total{result="error"}` o'smoqda.
Texnik xatolar Telegram'ga ham keladi: `.env.production` da `TECH_CHAT_ID`.

## 9. Xavfsizlik checklist
- [ ] SSH: faqat kalit, root login yo'q, fail2ban yoqilgan
- [ ] ufw: faqat 22/80/443; `ss -tlnp` da 8080 va 5432 faqat 127.0.0.1 / docker ichki tarmog'ida
- [ ] `.env.production` — `chmod 600`, egasi deploy; git'da yo'q
- [ ] Barcha secret'lar tasodifiy (openssl rand), dev dagi bilan bir xil emas; BOT_TOKEN faqat shu serverda
- [ ] unattended-upgrades yoqilgan; Docker image'lar har deployda yangilanadi (`node:22-alpine`, `postgres:16-alpine`)
- [ ] Backup offsite + shifrlangan; haftalik restore-test logi muvaffaqiyatli
- [ ] Panelga kuchli parol; kerak bo'lmagan panel adminlari o'chirilgan
- [ ] `/metrics` faqat token bilan va nginx orqali yopiq
