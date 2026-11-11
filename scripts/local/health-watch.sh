#!/usr/bin/env bash
# pnpm local:health-watch — one uptime check of the running server, meant for cron (every 5 minutes,
# installed by pnpm local:schedule install). It asks /health the way a device does (HTTPS with the
# local CA). After SERVA_HEALTH_FAILS failures in a row (default 3, so about 15 minutes) it sends
# one alert (scripts/local/alert.sh), and one more when the server answers again.
#   SERVA_HEALTH_URL    what to ask (default: https://localhost:<HTTPS port>/health). For a server
#                       elsewhere, give its public address; its certificate must be a trusted one.
#   SERVA_HEALTH_FAILS  failures in a row before the alert (default 3)
#   --quiet             print nothing while all is well (the cron line uses it)
# Without SERVA_ALERT_WEBHOOK_URL it only prints, and exits 1 on a failure. It cannot see a computer
# that is switched off: for that use an external uptime service (docs/local-server.md).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/local/lib.sh
source "$SCRIPT_DIR/lib.sh"
# shellcheck source=scripts/local/alert.sh
source "$SCRIPT_DIR/alert.sh"

quiet=""
[[ "${1:-}" == "--quiet" ]] && quiet=1
load_env
url="${SERVA_HEALTH_URL:-$(https_url localhost)/health}"
limit="${SERVA_HEALTH_FAILS:-3}"
[[ "$limit" =~ ^[0-9]+$ && "$limit" -ge 1 ]] || limit=3
state="$BACKUP_DIR/alert-state/health-failures"
mkdir -p "$(dirname "$state")"
failures=0
[[ -f "$state" ]] && failures="$(cat "$state" 2> /dev/null || echo 0)"
[[ "$failures" =~ ^[0-9]+$ ]] || failures=0

curl_args=(--noproxy '*' --silent --fail --max-time 10 --output /dev/null)
[[ -s "$CA_EXPORT" ]] && curl_args+=(--cacert "$CA_EXPORT")

if curl "${curl_args[@]}" "$url" 2> /dev/null; then
  if ((failures >= limit)); then send_alert "RECOVERED: the server answers again (it was down for about $((failures * 5)) minutes)." || true; fi
  rm -f "$state"
  [[ -n "$quiet" ]] || ok "Server answers: $url"
  exit 0
fi

failures=$((failures + 1))
printf '%s' "$failures" > "$state"
warn "The server did not answer ($failures in a row): $url"
# Alert once, when the limit is reached (not at every later check)
if ((failures == limit)); then
  send_alert "SERVER DOWN: /health has not answered for $failures checks in a row. Check the computer, Docker and: pnpm local:logs" || true
fi
exit 1
