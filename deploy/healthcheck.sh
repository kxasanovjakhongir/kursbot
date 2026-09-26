#!/usr/bin/env bash
# /ready 200 bo'lguncha kutadi (standart 90 soniya). Deploy, rollback va restore ishlatadi.
source "$(dirname "$0")/lib.sh"
URL="${HEALTH_URL:-http://127.0.0.1:8080/ready}"
TIMEOUT="${HEALTH_TIMEOUT:-90}"
for ((i = 0; i < TIMEOUT; i += 3)); do
  if body="$(curl -fsS --max-time 3 "$URL" 2>/dev/null)"; then
    log "tayyor: $body"
    exit 0
  fi
  sleep 3
done
die "$URL ${TIMEOUT}s ichida tayyor bo'lmadi"
