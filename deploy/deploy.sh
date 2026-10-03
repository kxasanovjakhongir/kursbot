#!/usr/bin/env bash
# Yangi versiyani chiqarish (serverda, repo papkasida):
#   deploy/deploy.sh                 — joriy checkout (masalan git pull dan keyin)
#   deploy/deploy.sh v1.4.0          — aniq teg/commit
#
# Tartib: checkout → build (versiya tegi bilan) → backup → migratsiya → app almashtirish → /ready → smoke.
# /ready 90 soniyada kelmasa — avtomatik oldingi versiyaga qaytadi (deploy/rollback.sh).
source "$(dirname "$0")/lib.sh"
cd "$ROOT" || exit 1
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE yo'q (cp .env.production.example .env.production)"

STATE="$ROOT/.deploy"
mkdir -p "$STATE"

if [[ -n "${1:-}" ]]; then
  git fetch --tags --quiet
  git checkout --quiet "$1"
fi
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || die "ishchi papkada commit qilinmagan o'zgarishlar bor — deploy faqat git dagi versiyadan"

VERSION="$(git rev-parse --short=12 HEAD)"
PREVIOUS="$(cat "$STATE/current" 2>/dev/null || true)"
export APP_IMAGE="darslik-bot:$VERSION" APP_IMAGE_MIGRATE="darslik-bot-migrate:$VERSION"
log "versiya: $VERSION (oldingi: ${PREVIOUS:-birinchi deploy})"

log "1/5 build"
dc build app migrate

log "2/5 deploydan oldingi backup"
if dc ps --status running db --quiet | grep -q .; then
  "$ROOT/deploy/backup.sh" >/dev/null
else
  log "baza hali ishlamayapti (birinchi deploy) — backup o'tkazib yuborildi"
  dc up -d db
fi

log "3/5 migratsiya"
dc --profile tools run --rm migrate

log "4/5 app almashtirilmoqda"
dc up -d --no-deps app
if ! "$ROOT/deploy/healthcheck.sh"; then
  log "YANGI VERSIYA SOG'LOM EMAS — loglar:"
  dc logs --tail=80 app >&2 || true
  if [[ -n "$PREVIOUS" ]]; then
    log "avtomatik rollback → $PREVIOUS"
    "$ROOT/deploy/rollback.sh" "$PREVIOUS"
  fi
  die "deploy muvaffaqiyatsiz: $VERSION"
fi

[[ -n "$PREVIOUS" && "$PREVIOUS" != "$VERSION" ]] && echo "$PREVIOUS" > "$STATE/previous"
echo "$VERSION" > "$STATE/current"
echo "$(date -u +%FT%TZ) $VERSION" >> "$STATE/history"

log "5/5 smoke test"
"$ROOT/deploy/smoke.sh"
log "✅ deploy tugadi: $VERSION"
# Eski image'lar: oxirgi 5 versiya saqlanadi (rollback uchun), qolgani o'chiriladi
docker image ls "darslik-bot" --format '{{.Tag}}' | grep -v -e latest -e "$VERSION" | tail -n +5 | xargs -r -I{} docker image rm "darslik-bot:{}" "darslik-bot-migrate:{}" >/dev/null 2>&1 || true
