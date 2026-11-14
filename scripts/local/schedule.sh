#!/usr/bin/env bash
# pnpm local:schedule <install | remove | status | check> — the daily backup (task M0-6, ADR-0014)
# and the jobs that watch it.
#
#   install  adds lines to this user's crontab. Running it again replaces them, never adds more:
#              every day at SERVA_BACKUP_TIME (default 02:17)  pnpm local:backup --label daily,
#                                                              logged to <backups>/daily.log
#              every day at 03:47                              pnpm local:cleanup (expired sessions…)
#            and, only when SERVA_ALERT_WEBHOOK_URL is set (scripts/local/alert.sh):
#              every hour                                      check: alert when the newest backup or
#                                                              off-site copy is older than 26 hours
#              every 5 minutes                                 health-watch: alert when /health is down
#   remove   takes the lines out.
#   status   the lines, the newest backup and the newest off-site copy (folder and bucket), with
#            their age. Exits 1 when either is older than 26 hours, or when no off-site copy is set.
#   check    like status, but quiet: if something is wrong, sends one alert (repeated every
#            SERVA_ALERT_REPEAT_HOURS while it stays wrong). Run by cron; run it by hand to test.
#
# The computer must be on at that time. On Windows the server runs inside WSL: cron there only
# runs while WSL runs (docs/local-server.md shows the Task Scheduler line that starts it).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/local/lib.sh
source "$SCRIPT_DIR/lib.sh"
# shellcheck source=scripts/local/alert.sh
source "$SCRIPT_DIR/alert.sh"

MARKER="# serva-daily-backup"
MARKER_CLEANUP="# serva-daily-cleanup"
MARKER_WATCH="# serva-backup-watch"
MARKER_HEALTH="# serva-health-watch"
ALL_MARKERS=("$MARKER" "$MARKER_CLEANUP" "$MARKER_WATCH" "$MARKER_HEALTH")
MAX_AGE_HOURS=26

# cron_entry <marker> <minute> <hour> <script and arguments> <log file>
# (minute and hour may be cron fields such as "*/5" and "*")
cron_entry() {
  printf '%s %s * * * cd %q && PATH=%q bash scripts/local/%s >> %q 2>&1 %s\n' \
    "$2" "$3" "$ROOT_DIR" "$PATH" "$4" "$5" "$1"
}

backup_entry() {
  local time="${SERVA_BACKUP_TIME:-02:17}"
  [[ "$time" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || die "SERVA_BACKUP_TIME must be HH:MM (24-hour), not '$time'."
  cron_entry "$MARKER" "$((10#${BASH_REMATCH[2]}))" "$((10#${BASH_REMATCH[1]}))" "backup.sh --label daily" "$BACKUP_DIR/daily.log"
}

need_crontab() {
  command -v crontab > /dev/null 2>&1 && return 0
  if is_wsl; then
    die "cron is not installed in WSL. Install it (sudo apt install cron), then run this again."
  fi
  die "crontab is not available on this computer. Install cron, or schedule 'pnpm local:backup --label daily' daily yourself."
}

current_crontab() { crontab -l 2> /dev/null || true; }

# The crontab without any line of ours
crontab_without_ours() {
  local out marker
  out="$(current_crontab)"
  for marker in "${ALL_MARKERS[@]}"; do
    out="$(grep -vF "$marker" <<< "$out" || true)"
  done
  if [[ -n "$out" ]]; then printf '%s\n' "$out"; fi
}

install() {
  need_crontab
  mkdir -p "$BACKUP_DIR"
  local lines
  lines="$(backup_entry)"$'\n'"$(cron_entry "$MARKER_CLEANUP" 47 3 cleanup.sh "$BACKUP_DIR/cleanup.log")"
  if alerts_enabled; then
    lines+=$'\n'"$(cron_entry "$MARKER_WATCH" 43 '*' "schedule.sh check" "$BACKUP_DIR/watch.log")"
    lines+=$'\n'"$(cron_entry "$MARKER_HEALTH" '*/5' '*' "health-watch.sh --quiet" "$BACKUP_DIR/health.log")"
  fi
  { crontab_without_ours; printf '%s\n' "$lines"; } | crontab -
  ok "Daily backup scheduled at ${SERVA_BACKUP_TIME:-02:17}: $BACKUP_DIR/daily.log keeps its output"
  ok "Daily cleanup scheduled at 03:47: $BACKUP_DIR/cleanup.log"
  if alerts_enabled; then
    ok "Alerts scheduled: stale-backup check every hour, server health check every 5 minutes"
  else
    warn "No alerts: SERVA_ALERT_WEBHOOK_URL is not set, so a failed or missing backup goes unnoticed until you run 'pnpm local:schedule status'. Set it, then run install again."
  fi
  [[ -n "${SERVA_OFFSITE_DIR:-}${SERVA_S3_BUCKET:-}" ]] ||
    warn "Neither SERVA_OFFSITE_DIR nor SERVA_S3_BUCKET is set: the daily backups stay on this computer only."
  if is_wsl; then
    warn "WSL: cron runs only while WSL runs. See docs/local-server.md › النسخ اليومي on Windows."
  fi
}

remove() {
  need_crontab
  crontab_without_ours | crontab -
  ok "Daily backup, cleanup and watch jobs removed from the schedule."
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
  if [[ -z "${SERVA_OFFSITE_DIR:-}${SERVA_S3_BUCKET:-}" ]]; then
    warn "No off-site copy (SERVA_OFFSITE_DIR or SERVA_S3_BUCKET): a fire or a theft would take every backup."
    problems=1
  fi
  if [[ -n "${SERVA_OFFSITE_DIR:-}" ]]; then
    if [[ ! -s "$BACKUP_DIR/last-offsite" ]]; then
      warn "No off-site folder copy made yet."
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
  fi
  if [[ -n "${SERVA_S3_BUCKET:-}" ]]; then
    # last-s3 is written only after the upload was read back and verified
    if [[ ! -s "$BACKUP_DIR/last-s3" ]]; then
      warn "No bucket upload made yet (SERVA_S3_BUCKET)."
      problems=1
    elif (($(age_hours "$BACKUP_DIR/last-s3") > MAX_AGE_HOURS)); then
      warn "The newest verified bucket upload is $(age_hours "$BACKUP_DIR/last-s3") hours old: $(cut -d' ' -f2 "$BACKUP_DIR/last-s3")"
      problems=1
    else
      ok "Newest bucket upload: $(cut -d' ' -f2 "$BACKUP_DIR/last-s3") ($(age_hours "$BACKUP_DIR/last-s3") h ago)"
    fi
  fi
  return "$problems"
}

# Quiet status for cron: one alert listing what is wrong, nothing when all is well
check() {
  local out="" rc=0 problems
  out="$(status 2>&1)" || rc=$?
  if ((rc == 0)); then
    clear_alert stale
    return 0
  fi
  # The warning lines, without colour codes ("not scheduled" is not for the scheduled job to report)
  problems="$(printf '%s\n' "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep '^!' | grep -v 'No daily backup is scheduled' | sed 's/^! *//' || true)"
  [[ -n "$problems" ]] || return 0
  warn "Backups are stale or missing:"$'\n'"$problems"
  alerts_enabled || return 1
  send_alert_once stale "BACKUPS NEED ATTENTION:"$'\n'"$problems" || true
  return 1
}

load_env
case "${1:-}" in
  install) install ;;
  remove) remove ;;
  status) status ;;
  check) check ;;
  *) die "Usage: pnpm local:schedule install | remove | status | check" ;;
esac
