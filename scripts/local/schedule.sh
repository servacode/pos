#!/usr/bin/env bash
# pnpm local:schedule <install | remove | status> — the daily backup (task M0-6, ADR-0014).
#
#   install  adds one line to this user's crontab: every day at SERVA_BACKUP_TIME (default 02:17)
#            pnpm local:backup --label daily, logged to <backups>/daily.log. Running it again
#            replaces the line, never adds a second one.
#   remove   takes the line out.
#   status   the line, the newest backup and the newest off-site copy, with their age. Exits 1 when
#            either is older than 26 hours, or when no off-site folder is set.
#
# The computer must be on at that time. On Windows the server runs inside WSL: cron there only
# runs while WSL runs (docs/local-server.md shows the Task Scheduler line that starts it).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/local/lib.sh
source "$SCRIPT_DIR/lib.sh"

MARKER="# serva-daily-backup"
MAX_AGE_HOURS=26

cron_line() {
  local time="${SERVA_BACKUP_TIME:-02:17}" hour minute
  [[ "$time" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || die "SERVA_BACKUP_TIME must be HH:MM (24-hour), not '$time'."
  hour="$((10#${BASH_REMATCH[1]}))"
  minute="$((10#${BASH_REMATCH[2]}))"
  printf '%s %s * * * cd %q && PATH=%q bash scripts/local/backup.sh --label daily >> %q 2>&1 %s\n' \
    "$minute" "$hour" "$ROOT_DIR" "$PATH" "$BACKUP_DIR/daily.log" "$MARKER"
}

need_crontab() {
  command -v crontab > /dev/null 2>&1 && return 0
  if is_wsl; then
    die "cron is not installed in WSL. Install it (sudo apt install cron), then run this again."
  fi
  die "crontab is not available on this computer. Install cron, or schedule 'pnpm local:backup --label daily' daily yourself."
}

current_crontab() { crontab -l 2> /dev/null || true; }

install() {
  need_crontab
  mkdir -p "$BACKUP_DIR"
  local line
  line="$(cron_line)"
  { current_crontab | grep -vF "$MARKER" || true; echo "$line"; } | crontab -
  ok "Daily backup scheduled at ${SERVA_BACKUP_TIME:-02:17}: $BACKUP_DIR/daily.log keeps its output"
  [[ -n "${SERVA_OFFSITE_DIR:-}" ]] || warn "SERVA_OFFSITE_DIR is not set: the daily backups stay on this computer only."
  if is_wsl; then
    warn "WSL: cron runs only while WSL runs. See docs/local-server.md › النسخ اليومي on Windows."
  fi
}

remove() {
  need_crontab
  { current_crontab | grep -vF "$MARKER" || true; } | crontab -
  ok "Daily backup removed from the schedule."
}

age_hours() { echo $((($(date +%s) - $(stat -c %Y "$1")) / 3600)); }

status() {
  local problems=0 newest line
  if command -v crontab > /dev/null 2>&1 && line="$(current_crontab | grep -F "$MARKER")"; then
    ok "Scheduled: ${line%% cd *} (minute hour …)"
  else
    warn "No daily backup is scheduled (pnpm local:schedule install)."
    problems=1
  fi
  newest="$(find "$BACKUP_DIR" -maxdepth 1 -name 'serva-*.dump.enc' 2> /dev/null | LC_ALL=C sort | tail -n 1)"
  if [[ -z "$newest" ]]; then
    warn "No backup yet in $BACKUP_DIR."
    problems=1
  elif (($(age_hours "$newest") > MAX_AGE_HOURS)); then
    warn "The newest backup is $(age_hours "$newest") hours old: $(basename "$newest")"
    problems=1
  else
    ok "Newest backup: $(basename "$newest") ($(age_hours "$newest") h ago)"
  fi
  if [[ -z "${SERVA_OFFSITE_DIR:-}" ]]; then
    warn "No off-site folder (SERVA_OFFSITE_DIR): a fire or a theft would take every backup."
    problems=1
  elif [[ ! -s "$BACKUP_DIR/last-offsite" ]]; then
    warn "No off-site copy made yet."
    problems=1
  else
    local copy
    copy="$(cut -d' ' -f2- "$BACKUP_DIR/last-offsite")"
    if [[ ! -f "$copy" ]]; then
      warn "The last off-site copy is gone or out of reach: $copy"
      problems=1
    elif (($(age_hours "$copy") > MAX_AGE_HOURS)); then
      warn "The newest off-site copy is $(age_hours "$copy") hours old: $copy"
      problems=1
    else
      ok "Newest off-site copy: $copy ($(age_hours "$copy") h ago)"
    fi
  fi
  return "$problems"
}

load_env
case "${1:-}" in
  install) install ;;
  remove) remove ;;
  status) status ;;
  *) die "Usage: pnpm local:schedule install | remove | status" ;;
esac
