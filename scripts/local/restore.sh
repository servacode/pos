#!/usr/bin/env bash
# pnpm local:restore <backup.dump.enc | latest> [--replace-live [--yes]] [--keep]
#
# Default: a RESTORE DRILL (tab 16 › اختبار الاستعادة). The live server is not touched:
#   1. the file's checksum is checked (.sha256 next to it);
#   2. a brand-new, throwaway PostgreSQL container (same version, no network) gets the roles;
#   3. the backup is decrypted inside it, its checksum compared with the manifest, and restored in
#      one transaction;
#   4. rows and a checksum of every table, plus row-level security, policies, grants, functions and
#      triggers, are compared with what the backup recorded;
#   5. a PASS/FAIL report is printed and saved in <backups>/drills/. The container is removed
#      (--keep leaves it running for a look).
#
# --replace-live: after a passing drill, puts the backup on the live server: a safety backup of the
# current data first, a restore into a new database that is checked the same way, then a swap. The
# previous database is kept, renamed serva_before_restore_<time>. Asks for confirmation (--yes skips).
#
# Restoring on a new computer: put the old SERVA_BACKUP_PASSPHRASE in deploy/local/.env (or the
# environment) first.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/local/lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() { die "Usage: pnpm local:restore <backup.dump.enc | latest> [--replace-live [--yes]] [--keep]"; }

file="" replace_live="" assume_yes="" keep=""
while (($# > 0)); do
  case "$1" in
    --replace-live) replace_live=1 ;;
    --yes) assume_yes=1 ;;
    --keep) keep=1 ;;
    -h | --help)
      sed -n '2,22p' "$0"
      exit 0
      ;;
    -*) usage ;;
    *)
      [[ -z "$file" ]] || usage
      file="$1"
      ;;
  esac
  shift
done
[[ -n "$file" ]] || usage

preflight
load_env
passphrase="${SERVA_BACKUP_PASSPHRASE:-}"
[[ -n "$passphrase" ]] || die "SERVA_BACKUP_PASSPHRASE is not set (deploy/local/.env)."

if [[ "$file" == latest ]]; then
  file="$(find "$BACKUP_DIR" -maxdepth 1 -name 'serva-*.dump.enc' 2> /dev/null | LC_ALL=C sort | tail -n 1)"
  [[ -n "$file" ]] || die "No backup found in $BACKUP_DIR. Make one: pnpm local:backup"
fi
# pnpm runs scripts from the repository root, so a relative path is taken from where you were
if [[ "$file" != /* && ! -f "$file" && -n "${INIT_CWD:-}" && -f "$INIT_CWD/$file" ]]; then file="$INIT_CWD/$file"; fi
file="${file%.manifest}"
file="${file%.sha256}"
[[ "$file" == *.dump.enc ]] || file="$file.dump.enc"
[[ -f "$file" ]] || die "Backup not found: $file"
file="$(cd "$(dirname "$file")" && pwd)/$(basename "$file")"
base="${file%.dump.enc}"
name="$(basename "$base")"
manifest="$base.manifest"
[[ -f "$manifest" ]] || die "The manifest is missing: $manifest (it records what the restore must contain)."
[[ -f "$file.sha256" ]] || die "The checksum file is missing: $file.sha256"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR/drills"
report="$BACKUP_DIR/drills/$stamp-$name.txt"
work="$(mktemp -d)"
container="serva-restore-drill-$stamp-$$"
cleanup() {
  if [[ -z "$keep" ]]; then docker rm -f "$container" > /dev/null 2>&1 || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

checks=()
failed=0
check() { # check <pass|fail> <text>
  if [[ "$1" == pass ]]; then checks+=("PASS  $2"); else
    checks+=("FAIL  $2")
    failed=1
  fi
}
manifest_value() { sed -n "s/^$1=//p" "$manifest" | head -n 1; }
manifest_stats() { sed -n '/^---stats---$/,$p' "$manifest" | tail -n +2; }

write_report() {
  local verdict="$1"
  {
    echo "Serva restore drill report"
    echo "=========================="
    echo "Result:          $verdict"
    echo "Drill time:      $stamp (UTC)"
    echo "Backup:          $file"
    echo "Backup taken:    $(manifest_value created_utc) ($(manifest_value label)), commit $(manifest_value source_commit)"
    echo "PostgreSQL:      backup $(manifest_value postgres_version), restored on $restore_image"
    echo "Tables / rows:   $(manifest_value tables) / $(manifest_value rows) recorded"
    echo "Restore time:    ${restore_seconds:-?}s"
    echo "Target:          ${target_desc:-fresh container}"
    echo
    printf '%s\n' "${checks[@]}"
    if [[ -s "$work/diff" ]]; then
      echo
      echo "Differences (< recorded in the backup, > found after restore):"
      cat "$work/diff"
    fi
  } > "$report"
  cat "$report"
}

finish_fail() {
  write_report FAIL > /dev/null
  echo >&2
  cat "$report" >&2
  banner "$C_RED" "RESTORE DRILL FAILED: $1" "فشل تمرين الاستعادة. لا تعتمد على هذه النسخة." >&2
  echo "Report saved: $report" >&2
  exit 1
}

restore_image="$(postgres_image)"
[[ -n "$restore_image" ]] || die "Cannot read the postgres image from $COMPOSE_FILE_PATH"
expected_sha="$(manifest_value dump_sha256)"
[[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]] || die "The manifest has no valid dump_sha256: $manifest"

# 1. The file is intact
if (cd "$(dirname "$file")" && sha256sum --status -c "$(basename "$file").sha256"); then
  check pass "Encrypted file checksum matches ($(basename "$file").sha256)"
else
  check fail "Encrypted file checksum does NOT match: the file is damaged or was changed"
  finish_fail "the backup file is damaged"
fi
if [[ "$(sha256sum < "$file" | cut -d' ' -f1)" == "$(manifest_value encrypted_sha256)" ]]; then
  check pass "Encrypted file matches the manifest"
else
  check fail "Encrypted file does not match the manifest"
  finish_fail "the backup file and its manifest disagree"
fi

# 2. A fresh, isolated PostgreSQL
info "Starting a fresh PostgreSQL container ($restore_image, no network)…"
docker run -d --name "$container" --network none --label serva.restore-drill=1 \
  -e POSTGRES_PASSWORD="$(random_hex 24)" \
  -v "$DEPLOY_DIR/pg:/serva/pg:ro" \
  -v "$ROOT_DIR/scripts/db-bootstrap.sql:/serva/bootstrap.sql:ro" \
  "$restore_image" > /dev/null || die "Cannot start a container from $restore_image"
for _ in $(seq 1 60); do
  docker exec "$container" pg_isready -q -h 127.0.0.1 -U postgres 2> /dev/null && break
  sleep 1
done
docker exec "$container" pg_isready -q -h 127.0.0.1 -U postgres || die "The drill container did not start."
docker exec "$container" psql --no-psqlrc -q -U postgres -v ON_ERROR_STOP=1 \
  -v owner_password="$(random_hex 24)" -v app_password="$(random_hex 24)" -f /serva/bootstrap.sql > /dev/null ||
  die "Cannot create the roles in the drill container."
check pass "Fresh container with the serva_owner and serva_app roles"

# restore_into <container-command…>: restores stdin into a database and compares; sets restore_seconds
restore_and_compare() {
  local what="$1"
  shift
  local t0=$SECONDS
  if ! "$@" < "$file" > "$work/out" 2> "$work/restore.err"; then
    restore_seconds=$((SECONDS - t0))
    sed 's/^/    /' "$work/restore.err" | tail -n 20 >&2
    if grep -q 'cannot decrypt' "$work/restore.err"; then
      check fail "$what: cannot decrypt (wrong SERVA_BACKUP_PASSPHRASE, or damaged file)"
    elif grep -q 'does not match the checksum' "$work/restore.err"; then
      check fail "$what: decrypted dump does not match the manifest checksum"
    else
      check fail "$what: pg_restore failed (see the errors above)"
    fi
    finish_fail "the backup could not be restored"
  fi
  restore_seconds=$((SECONDS - t0))
  check pass "$what: decrypted, dump checksum matches the manifest, restored in one transaction (${restore_seconds}s)"

  sed -n '/^---stats---$/,$p' "$work/out" | tail -n +2 | LC_ALL=C sort > "$work/after"
  manifest_stats > "$work/before"
  if diff "$work/before" "$work/after" > "$work/diff"; then
    : > "$work/diff"
    check pass "$what: all $(manifest_value tables) tables have the same rows and checksums ($(manifest_value rows) rows)"
    check pass "$what: row-level security, policies, grants, functions and triggers identical"
    if [[ "$(sha256sum < "$work/after" | cut -d' ' -f1)" == "$(manifest_value fingerprint_sha256)" ]]; then
      check pass "$what: database fingerprint matches ($(manifest_value fingerprint_sha256 | cut -c1-16)…)"
    else
      check fail "$what: database fingerprint differs from the manifest"
    fi
  else
    check fail "$what: $(grep -c '^<' "$work/diff" || true) table/schema line(s) recorded in the backup differ after the restore"
  fi
}

info "Restoring and verifying…"
restore_and_compare "Drill" docker exec -i -u postgres -e SERVA_BACKUP_PASSPHRASE "$container" \
  bash /serva/pg/restore.sh serva "$expected_sha"
((failed == 0)) || finish_fail "the restored data differs from the backup"

if [[ -z "$replace_live" ]]; then
  write_report PASS
  banner "$C_GREEN" "RESTORE DRILL PASSED" "نجح تمرين الاستعادة: النسخة سليمة وقابلة للاستعادة."
  echo "Report saved: $report"
  [[ -n "$keep" ]] && echo "Drill container kept: docker exec -it -u postgres $container psql -d serva   (remove: docker rm -f $container)"
  exit 0
fi

# ─── --replace-live ─────────────────────────────────────────────────────────────────────────────
target_desc="live server (database serva)"
postgres_running || die "The live server is not running. Start it first: pnpm local:up"
if [[ -z "$assume_yes" ]]; then
  banner "$C_YELLOW" "This REPLACES the live data with the backup from $(manifest_value created_utc)." \
    "Everything entered after that time will no longer be in the server (it is kept aside)." \
    "سيتم استبدال بيانات الخادم بهذه النسخة."
  read -r -p "Type RESTORE to continue: " answer
  [[ "$answer" == RESTORE ]] || die "Cancelled. Nothing was changed."
fi

info "Safety backup of the current data first…"
bash "$SCRIPT_DIR/backup.sh" --label pre-restore || die "The safety backup failed; nothing was changed."

psql_live() { dc exec -T -u postgres postgres psql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }
psql_live -c "DROP DATABASE IF EXISTS serva_restoring" -c "CREATE DATABASE serva_restoring OWNER serva_owner" ||
  die "Cannot create the restore database on the live server."
info "Restoring into a new database on the live server and verifying…"
restore_and_compare "Live" dc exec -T -u postgres -e SERVA_BACKUP_PASSPHRASE postgres \
  bash /serva/pg/restore.sh serva_restoring "$expected_sha"
if ((failed != 0)); then
  psql_live -c "DROP DATABASE IF EXISTS serva_restoring" || true
  finish_fail "the restore on the live server did not verify; the live data was NOT changed"
fi

old_db="serva_before_restore_$(date -u +%Y%m%d_%H%M%S)"
info "Swapping databases (the app stops for a few seconds)…"
dc stop web api
psql_live \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('serva', 'serva_restoring') AND pid <> pg_backend_pid()" \
  -c "ALTER DATABASE serva RENAME TO $old_db" \
  -c "ALTER DATABASE serva_restoring RENAME TO serva" > /dev/null ||
  {
    dc up -d
    die "The database swap failed; the server was restarted on the previous data."
  }
check pass "Live database replaced; the previous one is kept as $old_db"
# Tab 15/16: a restored server starts a new epoch, so every device resends its recent documents
# (duplicates are ignored) and downloads everything again. Older backups predate the function.
if psql_live -d serva -tA -c "SELECT to_regprocedure('server_epoch_bump()') IS NOT NULL" | grep -q t; then
  psql_live -d serva -c "SELECT server_epoch_bump()" > /dev/null || finish_fail "could not start a new sync epoch"
  check pass "New sync epoch started: devices will resend and download again"
fi
dc up -d --wait --wait-timeout "${SERVA_WAIT_TIMEOUT:-300}" || finish_fail "the server did not start on the restored data"
after_up
bash "$SCRIPT_DIR/smoke.sh" || finish_fail "the smoke test failed after the restore"
check pass "Server restarted on the restored data and the smoke test passed"
write_report PASS
banner "$C_GREEN" "RESTORED ON THE LIVE SERVER" "تمت الاستعادة على الخادم بنجاح."
echo "Report saved: $report"
echo "The previous data is kept in database $old_db. When you are sure, remove it with:"
echo "  docker compose -f deploy/local/compose.yml exec -u postgres postgres dropdb $old_db"
