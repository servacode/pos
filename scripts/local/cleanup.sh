#!/usr/bin/env bash
# pnpm local:cleanup — deletes what can never be used again and would grow without limit:
# expired sign-in sessions (one new row per token refresh), unused pairing codes, old sign-up codes
# and rate-limit counters (deploy/local/pg/cleanup.sql). Runs daily through pnpm local:schedule.
# Safe to run any time and as often as you like. Failures send an alert (scripts/local/alert.sh).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/local/lib.sh
source "$SCRIPT_DIR/lib.sh"
# shellcheck source=scripts/local/alert.sh
source "$SCRIPT_DIR/alert.sh"

on_exit() {
  local rc=$?
  trap - EXIT
  if ((rc != 0)); then
    send_alert_once cleanup "CLEANUP FAILED: ${SERVA_LAST_ERROR:-the cleanup script stopped unexpectedly (exit $rc).} Old sessions may be piling up." || true
  fi
  exit "$rc"
}
load_env
trap on_exit EXIT
preflight
postgres_running || die "The database is not running. Start the server first: pnpm local:up"

out="$(dc exec -T -u postgres postgres psql --no-psqlrc -X -q -d serva -f /serva/pg/cleanup.sql)" ||
  die "The cleanup query failed (run it again by hand: pnpm local:cleanup)."
summary=""
while IFS='|' read -r table count; do
  [[ -n "$table" ]] && summary+="$table: $count  "
done <<< "$out"
clear_alert cleanup
ok "Cleanup done. Rows deleted — ${summary:-nothing}"
