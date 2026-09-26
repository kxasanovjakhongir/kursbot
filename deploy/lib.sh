#!/usr/bin/env bash
# Umumiy yordamchilar (boshqa skriptlar source qiladi)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.production}"
# USE_DOCKER=0 — lokal test: psql/pg_dump to'g'ridan-to'g'ri DATABASE_URL bilan
USE_DOCKER="${USE_DOCKER:-1}"

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() { log "XATO: $*"; exit 1; }

dc() { docker compose --env-file "$ENV_FILE" -f "$ROOT/docker-compose.yml" "$@"; }

# Baza buyrug'i: serverda db konteyneri ichida, lokal testda — host dagi klient
pg() {
  local tool="$1"; shift
  if [[ "$USE_DOCKER" == "1" ]]; then
    dc exec -T db "$tool" -U bot "$@"
  else
    [[ -n "${DATABASE_URL:-}" ]] || die "USE_DOCKER=0 uchun DATABASE_URL kerak"
    "$tool" "$@"
  fi
}

# Baza nomi yoki (lokalda) ulanish satri
db_target() {
  local name="$1"
  if [[ "$USE_DOCKER" == "1" ]]; then echo "$name"; else echo "${DATABASE_URL%/*}/$name"; fi
}
