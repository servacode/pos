#!/usr/bin/env bash
# Runs inside the postgres container as the postgres user (called by scripts/local/backup.sh).
#   backup.sh <work-dir> [database]
# Writes into <work-dir>:
#   dump.enc     pg_dump custom format, encrypted with SERVA_BACKUP_PASSPHRASE (AES-256)
#   dump.sha256  sha256 of the unencrypted dump, checked again before any restore
#   stats.txt    table fingerprint taken from the same snapshot (table-stats.sql)
# The unencrypted dump never leaves the container and is deleted here.
set -euo pipefail

work="${1:?usage: backup.sh <work-dir> [database]}"
db="${2:-serva}"
passphrase="${SERVA_BACKUP_PASSPHRASE:-}"
if [[ ${#passphrase} -lt 16 ]]; then
  echo "backup: SERVA_BACKUP_PASSPHRASE is missing or shorter than 16 characters." >&2
  exit 1
fi

umask 077
mkdir -p "$work"
trap 'rm -f "$work/dump" "$work/dump.status"' EXIT

SERVA_DB="$db" SERVA_WORK="$work" psql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -d "$db" \
  -v stats_file="$work/stats.txt" -f /serva/pg/snapshot-dump.sql

status="$(cat "$work/dump.status" 2>/dev/null || echo missing)"
if [[ "$status" != "0" ]]; then
  echo "backup: pg_dump failed (status: $status)." >&2
  exit 1
fi
# The archive must be readable before it is called a backup
pg_restore --list "$work/dump" > /dev/null

sha256sum "$work/dump" | cut -d' ' -f1 > "$work/dump.sha256"
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -salt \
  -pass env:SERVA_BACKUP_PASSPHRASE -in "$work/dump" -out "$work/dump.enc"
pg_dump --version | sed 's/^pg_dump (PostgreSQL) //' > "$work/pg_version"
