#!/usr/bin/env bash
# Oldingi versiyaga qaytish (image serverda saqlangan — qayta build shart emas):
#   deploy/rollback.sh              — .deploy/previous dagi versiya
#   deploy/rollback.sh <versiya>    — aniq versiya (docker image ls darslik-bot)
#
# Migratsiyalar QAYTARILMAYDI: loyihada migratsiyalar faqat qo'shuvchi (expand) — eski kod yangi
# ustun/jadvallarni shunchaki ishlatmaydi. Ma'lumot o'chiradigan migratsiya bo'lsa: deploy/restore.sh.
source "$(dirname "$0")/lib.sh"
cd "$ROOT" || exit 1
STATE="$ROOT/.deploy"
TARGET="${1:-$(cat "$STATE/previous" 2>/dev/null || true)}"
[[ -n "$TARGET" ]] || die "qaysi versiyaga qaytish noma'lum (.deploy/previous yo'q). Mavjudlar: docker image ls darslik-bot"
docker image inspect "darslik-bot:$TARGET" >/dev/null 2>&1 || die "image topilmadi: darslik-bot:$TARGET"

log "rollback → $TARGET"
export APP_IMAGE="darslik-bot:$TARGET"
dc up -d --no-deps app
"$ROOT/deploy/healthcheck.sh"
CURRENT="$(cat "$STATE/current" 2>/dev/null || true)"
[[ -n "$CURRENT" && "$CURRENT" != "$TARGET" ]] && echo "$CURRENT" > "$STATE/previous"
echo "$TARGET" > "$STATE/current"
echo "$(date -u +%FT%TZ) $TARGET (rollback)" >> "$STATE/history"
log "✅ rollback tugadi: $TARGET"
