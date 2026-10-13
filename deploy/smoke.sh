#!/usr/bin/env bash
# Deploydan keyingi tez tekshiruv (faqat o'qish — hech narsa yozmaydi, foydalanuvchilarga xabar yubormaydi)
source "$(dirname "$0")/lib.sh"
BASE="${SMOKE_BASE:-http://127.0.0.1:8080}"
fail=0
check() {
  local name="$1" url="$2" want="$3" code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)"
  if [[ "$code" =~ ^($want)$ ]]; then log "ok   $name ($code)"; else log "FAIL $name: $code (kutilgan $want)"; fail=1; fi
}
check "health"            "$BASE/health" 200
check "ready"             "$BASE/ready" 200
check "admin panel"       "$BASE/" 200
check "api himoyalangan"  "$BASE/api/dashboard" 401
check "metrics yopiq"     "$BASE/metrics" "401|404"

# Telegram webhook holati: kutayotgan update lar va oxirgi xato (token konteyner ichida qoladi).
# Token ilovaning o'zi kabi olinadi (paneldan almashtirilgan bo'lsa — bazadagisi). Tarmoq xatosida 3 marta urinadi.
[[ "${SKIP_WEBHOOK_CHECK:-0}" == "1" ]] || dc exec -T app node -e '
  // Node har bir IP manzilga 250 ms beradi (happy eyeballs) — sekin tarmoqda "fetch failed" chiqadi
  require("node:net").setDefaultAutoSelectFamilyAttemptTimeout(3000);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    const token = await Promise.resolve()
      .then(() => require("./dist/services/botToken").resolveBotToken())
      .then((t) => t.token)
      .catch(() => process.env.BOT_TOKEN);
    let last;
    for (let i = 1; i <= 3; i++) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(10000) });
        const body = await res.json();
        if (!body.ok) {
          console.error(`getWebhookInfo: Telegram ${res.status} ${body.description ?? ""}`);
          process.exit(1);
        }
        const w = body.result;
        console.log(`webhook: ${w.url ? "ornatilgan" : "YOQ"} · kutmoqda: ${w.pending_update_count} · oxirgi xato: ${w.last_error_message ?? "yoq"}`);
        process.exit(w.url ? 0 : 1);
      } catch (e) {
        last = e;
        if (i < 3) await sleep(2000);
      }
    }
    const cause = last.cause ? ` (${last.cause.code ?? last.cause.message})` : "";
    console.error(`getWebhookInfo xatosi, 3 urinish: ${last.message}${cause}`);
    process.exit(1);
  })();
' >&2 || fail=1
[[ "$fail" == 0 ]] || die "smoke test muvaffaqiyatsiz"
log "smoke test: hammasi joyida"
