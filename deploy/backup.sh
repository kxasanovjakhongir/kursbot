#!/usr/bin/env bash
# Baza backup'i: pg_dump (custom format, siqilgan) → tekshirish → (ixtiyoriy) shifrlash → (ixtiyoriy) offsite → eskilarini o'chirish.
# Cron (har kuni 03:15):  15 3 * * *  /srv/darslik-bot/deploy/backup.sh >> /var/log/darslik-backup.log 2>&1
#
#   BACKUP_DIR           qayerga (standart /var/backups/darslik-bot)
#   RETENTION_DAYS       necha kun saqlanadi (standart 14)
#   BACKUP_GPG_RECIPIENT berilsa — gpg bilan shifrlanadi (ochiq kalit serverda, maxfiy kalit — serverdan tashqarida!)
#   BACKUP_RCLONE_REMOTE berilsa — rclone bilan boshqa joyga nusxa (masalan "s3:darslik-backups")
source "$(dirname "$0")/lib.sh"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/darslik-bot}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DB_NAME="${DB_NAME:-darslik_bot}"
umask 077
mkdir -p "$BACKUP_DIR"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/${DB_NAME}_${ts}.dump"
log "backup: $DB_NAME → $file"
pg pg_dump -d "$(db_target "$DB_NAME")" --format=custom --compress=6 --no-owner --no-privileges > "$file.part"

# Yaroqliligini tekshirish: arxiv o'qiladimi va jadvallar bormi
tables="$(pg pg_restore --list < "$file.part" 2>/dev/null | grep -c ' TABLE DATA ' || true)"
[[ "$tables" -gt 0 ]] || { rm -f "$file.part"; die "backup buzilgan yoki bo'sh (TABLE DATA: $tables)"; }
mv "$file.part" "$file"
log "ok: $(du -h "$file" | cut -f1), jadvallar: $tables"

if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
  gpg --batch --yes --trust-model always --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$file.gpg" "$file"
  rm -f "$file"
  file="$file.gpg"
  log "shifrlandi: $file"
fi

if [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  rclone copy "$file" "$BACKUP_RCLONE_REMOTE/" --immutable
  log "offsite: $BACKUP_RCLONE_REMOTE"
fi

find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}_*.dump*" -type f -mtime +"$RETENTION_DAYS" -print -delete | sed 's/^/eski backup ochirildi: /' >&2 || true
echo "$file"
