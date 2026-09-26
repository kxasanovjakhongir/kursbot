#!/usr/bin/env bash
# Backup'dan tiklash.
#   deploy/restore.sh --test <fayl>   — VAQTINCHALIK bazaga tiklab, jadvallarni sanaydi va o'chiradi (production ga tegmaydi).
#                                       Har hafta shu bilan backup ishlashini tekshiring.
#   deploy/restore.sh <fayl>          — PRODUCTION bazani almashtiradi: app to'xtaydi → tiklash → app yonadi.
#                                       Oldin avtomatik "xavfsizlik" backup'i olinadi.
source "$(dirname "$0")/lib.sh"

mode="prod"
if [[ "${1:-}" == "--test" ]]; then mode="test"; shift; fi
src="${1:-}"
[[ -n "$src" && -f "$src" ]] || die "backup fayli topilmadi: $src"

work="$src"
if [[ "$src" == *.gpg ]]; then
  work="$(mktemp)"
  cleanup_files() { rm -f "$work"; }
  trap cleanup_files EXIT
  gpg --batch --decrypt --output "$work" "$src"
fi

count_rows() {
  local sql="select relname || ' = ' || n_live_tup from pg_stat_user_tables where n_live_tup > 0 order by relname"
  pg psql -d "$(db_target "$1")" -At -c "$sql" 2>/dev/null
}

if [[ "$mode" == "test" ]]; then
  tmp="restore_test_$(date +%s)"
  log "sinov: $src → vaqtinchalik baza $tmp"
  pg psql -d "$(db_target postgres)" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $tmp"
  drop_tmp() {
    pg psql -d "$(db_target postgres)" -q -c "DROP DATABASE IF EXISTS $tmp" >/dev/null 2>&1 || true
    [[ "$work" == "$src" ]] || rm -f "$work"
  }
  trap drop_tmp EXIT
  pg pg_restore -d "$(db_target "$tmp")" --no-owner --no-privileges --exit-on-error < "$work"
  pg psql -d "$(db_target "$tmp")" -q -c "ANALYZE" >/dev/null
  log "tiklandi. Jadvallar (qatorlar):"
  count_rows "$tmp" >&2
  migrations="$(pg psql -d "$(db_target "$tmp")" -At -c "select count(*) from _prisma_migrations where finished_at is not null")"
  log "migratsiyalar: $migrations — sinov muvaffaqiyatli, vaqtinchalik baza o'chiriladi"
  exit 0
fi

[[ "${CONFIRM:-}" == "ha" ]] || die "PRODUCTION baza almashtiriladi. Ishonchingiz komil bo'lsa: CONFIRM=ha $0 $src"
log "xavfsizlik backup'i (tiklashdan oldingi holat)"
"$(dirname "$0")/backup.sh" >/dev/null
log "app to'xtatilmoqda"
dc stop app
log "tiklanmoqda: $src"
pg pg_restore -d darslik_bot --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error < "$work"
log "app ishga tushirilmoqda"
dc up -d app
"$(dirname "$0")/healthcheck.sh"
log "tiklash tugadi"
