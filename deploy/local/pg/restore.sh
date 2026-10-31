#!/usr/bin/env bash
# Runs inside a postgres container as the postgres user (called by scripts/local/restore.sh).
#   restore.sh <database> <expected-dump-sha256>  < backup.dump.enc
# Decrypts the backup read from stdin, refuses it unless the decrypted dump has the sha256 recorded
# at backup time, restores it into <database> in one transaction (all or nothing), then prints:
#   dump_sha256=<hex>
#   ---stats---
#   <table-stats.sql output>
set -euo pipefail

db="${1:?usage: restore.sh <database> <expected-sha256>}"
expected="${2:?usage: restore.sh <database> <expected-sha256>}"
if [[ -z "${SERVA_BACKUP_PASSPHRASE:-}" ]]; then
  echo "restore: SERVA_BACKUP_PASSPHRASE is not set." >&2
  exit 1
fi

umask 077
work="$(mktemp -d /tmp/serva-restore.XXXXXX)"
trap 'rm -rf "$work"' EXIT

cat > "$work/dump.enc"
if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 \
  -pass env:SERVA_BACKUP_PASSPHRASE -in "$work/dump.enc" -out "$work/dump" 2> "$work/openssl.err"; then
  echo "restore: cannot decrypt the backup (wrong SERVA_BACKUP_PASSPHRASE, or the file is damaged)." >&2
  exit 3
fi
rm -f "$work/dump.enc"

actual="$(sha256sum "$work/dump" | cut -d' ' -f1)"
echo "dump_sha256=$actual"
if [[ "$actual" != "$expected" ]]; then
  echo "restore: the decrypted dump does not match the checksum in the manifest; not restoring." >&2
  exit 4
fi

pg_restore --exit-on-error --single-transaction --no-password --dbname="$db" "$work/dump" >&2
echo "---stats---"
psql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -d "$db" -f /serva/pg/table-stats.sql
