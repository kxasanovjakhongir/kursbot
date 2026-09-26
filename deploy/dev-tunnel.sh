#!/usr/bin/env bash
# Lokal ishlab chiqish: Mini App ni Telegram'ga HTTPS tunnel orqali ochadi.
# Avval cloudflared quick tunnel, u ishlamasa (masalan, 429 limit) — localhost.run (ssh).
# Har ulanishda yangi manzil keladi — skript uni .env dagi WEB_APP_URL ga yozadi va `npm run dev` ni
# qayta ishga tushiradi (src/index.ts ga touch → tsx watch). Menu Button start paytida o'zi yangilanadi.
# Tunnel o'lsa (Mac uxlab qolgach tunnel serveri uni o'chiradi, jarayon esa tirik qolib cheksiz
# qayta urinadi) — skript buni sezadi va yangi tunnel ochadi. To'xtatish: Ctrl+C.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
PORT="$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2)"
PORT="${PORT:-8080}"
LOG="$(mktemp -t darslik-tunnel)"
CHECK_EVERY=20   # soniya
MAX_FAILS=3      # ketma-ket shuncha tekshiruv o'tmasa — tunnel qayta ochiladi
PROVIDERS=(cloudflare localhostrun)

# Skript ishlab turganda Mac uxlab qolmasin (ekran o'chishi mumkin)
command -v caffeinate >/dev/null && caffeinate -i -w $$ &

start_tunnel() {
  case "$1" in
    cloudflare)
      command -v cloudflared >/dev/null || return 1
      cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" >"$LOG" 2>&1 & ;;
    localhostrun)
      ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
        -o ExitOnForwardFailure=yes -R "80:localhost:$PORT" nokey@localhost.run >"$LOG" 2>&1 & ;;
  esac
  PID=$!
}

# Faqat tunnelning o'z manzili. cloudflared logida Cloudflare API manzili (https://api.trycloudflare.com/...)
# ham chiqadi — u tunnel emas (ochilsa "Method Not Allowed"); localhost.run'da esa admin.localhost.run bor.
# Quick tunnel nomi har doim bir nechta so'zdan iborat: so'z-so'z-so'z.trycloudflare.com
find_url() {
  grep -oE 'https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com|https://[a-z0-9]+\.lhr\.life' "$LOG" | grep -v '^https://api\.' | head -1
}

set_url() {
  local url="$1/app/"
  if grep -qE '^WEB_APP_URL=' "$ENV_FILE"; then
    sed -i '' "s#^WEB_APP_URL=.*#WEB_APP_URL=$url#" "$ENV_FILE"
  else
    printf '\nWEB_APP_URL=%s\n' "$url" >> "$ENV_FILE"
  fi
  touch "$ROOT/src/index.ts"
  echo "✅ $(date +%H:%M) Mini App: $url  (.env yangilandi, bot qayta ishga tushmoqda — botda /start bosing)"
}

dead() {
  ! kill -0 "$PID" 2>/dev/null || grep -q "Tunnel not found" "$LOG"
}

trap 'kill "${PID:-}" 2>/dev/null; rm -f "$LOG"; exit 0' INT TERM

i=0
backoff=5
while true; do
  provider="${PROVIDERS[$((i % ${#PROVIDERS[@]}))]}"
  : > "$LOG"
  PID=""
  URL=""
  if start_tunnel "$provider"; then
    for _ in $(seq 1 30); do
      URL="$(find_url)"
      [ -n "$URL" ] && break
      kill -0 "$PID" 2>/dev/null || break
      sleep 1
    done
  fi

  if [ -n "$URL" ]; then
    backoff=5
    set_url "$URL"
    sleep 15   # yangi domen DNS da paydo bo'lishiga vaqt
    fails=0
    while [ "$fails" -lt "$MAX_FAILS" ] && ! dead; do
      if curl -s -o /dev/null --max-time 10 "$URL/app/"; then fails=0; else fails=$((fails + 1)); fi
      sleep "$CHECK_EVERY"
    done
    echo "⚠️  $(date +%H:%M) Tunnel ($provider) uzildi — yangisi ochilmoqda..."
  else
    echo "❌ $(date +%H:%M) $provider tunnel ochilmadi: $(grep -iE 'error|failed|denied' "$LOG" | tail -1)"
    i=$((i + 1))   # keyingi provayderni sinaymiz
    # Ikkalasi ham ishlamasa — kutish oshib boradi (limitni battar uzaytirmaslik uchun), 5 daqiqagacha
    if [ $((i % ${#PROVIDERS[@]})) -eq 0 ]; then
      echo "   ${backoff}s kutib, qayta uriniladi..."
      sleep "$backoff"
      backoff=$((backoff * 2 > 300 ? 300 : backoff * 2))
    fi
  fi
  [ -n "$PID" ] && { kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null; }
  sleep 3
done
