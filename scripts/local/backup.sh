#!/usr/bin/env bash
# pnpm local:backup [--label <word>] — an encrypted, timestamped backup of the local server's
# database, in deploy/local/backups (or SERVA_BACKUP_DIR):
#   serva-<UTC time>[-label].dump.enc         pg_dump custom format, AES-256 (SERVA_BACKUP_PASSPHRASE)
#   serva-<UTC time>[-label].dump.enc.sha256  checksum of the encrypted file (sha256sum -c)
#   serva-<UTC time>[-label].manifest         what restore checks: dump checksum, rows and checksum
#                                              per table, all from the same snapshot as the dump
# Keeps the newest SERVA_BACKUP_KEEP backups (default 14) and deletes older ones.
#
# This is the local-server tool. The hosted server uses pgBackRest with continuous archiving and an
# off-site copy (tab 16 › النسخ الاحتياطي والاستعادة).
set -euo pipefail
# shellcheck source=scripts/local/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

label=""
while (($# > 0)); do
  case "$1" in
    --label)
      label="${2:?--label needs a word}"
      shift 2
      ;;
    -h | --help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) die "Unknown option: $1 (usage: pnpm local:backup [--label <word>])" ;;
  esac
done
[[ -z "$label" || "$label" =~ ^[a-z0-9-]{1,32}$ ]] || die "The label may only hold a-z, 0-9 and '-'."

preflight
load_env
passphrase="${SERVA_BACKUP_PASSPHRASE:-}"
[[ ${#passphrase} -ge 16 ]] || die "SERVA_BACKUP_PASSPHRASE is missing in $ENV_FILE."
postgres_running || die "The database is not running. Start the server first: pnpm local:up"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="serva-$stamp${label:+-$label}"
work="/tmp/serva-backup-$stamp-$$"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cleanup() {
  dc exec -T -u postgres postgres rm -rf "$work" > /dev/null 2>&1 || true
  rm -f "$BACKUP_DIR/$name".*.partial
}
trap cleanup EXIT

started=$SECONDS
info "Backing up the database (snapshot, dump, encryption)…"
dc exec -T -u postgres -e SERVA_BACKUP_PASSPHRASE postgres bash /serva/pg/backup.sh "$work" serva ||
  die "BACKUP FAILED: the database could not be dumped. Nothing was saved."

in_container() { dc exec -T -u postgres postgres cat "$work/$1"; }
in_container dump.enc > "$BACKUP_DIR/$name.dump.enc.partial"
in_container stats.txt > "$BACKUP_DIR/$name.stats.partial"
dump_sha="$(in_container dump.sha256)"
pg_version="$(in_container pg_version)"
[[ "$dump_sha" =~ ^[0-9a-f]{64}$ ]] || die "BACKUP FAILED: no checksum for the dump."
[[ -s "$BACKUP_DIR/$name.dump.enc.partial" ]] || die "BACKUP FAILED: the encrypted dump is empty."

LC_ALL=C sort "$BACKUP_DIR/$name.stats.partial" > "$BACKUP_DIR/$name.stats.sorted.partial"
tables="$(grep -vc '^meta:' "$BACKUP_DIR/$name.stats.sorted.partial" || true)"
rows="$(grep -v '^meta:' "$BACKUP_DIR/$name.stats.sorted.partial" | awk -F'|' '{ s += $2 } END { print s + 0 }')"
fingerprint="$(sha256sum < "$BACKUP_DIR/$name.stats.sorted.partial" | cut -d' ' -f1)"

mv "$BACKUP_DIR/$name.dump.enc.partial" "$BACKUP_DIR/$name.dump.enc"
enc_sha="$(sha256sum < "$BACKUP_DIR/$name.dump.enc" | cut -d' ' -f1)"
printf '%s  %s\n' "$enc_sha" "$name.dump.enc" > "$BACKUP_DIR/$name.dump.enc.sha256"
{
  echo "# Serva local backup manifest. Checked by: pnpm local:restore $name.dump.enc"
  echo "format=serva-local-backup-1"
  echo "created_utc=$stamp"
  echo "label=${label:-manual}"
  echo "database=serva"
  echo "postgres_version=$pg_version"
  echo "source_commit=$(git -C "$ROOT_DIR" rev-parse --short HEAD 2> /dev/null || echo unknown)"
  echo "encryption=openssl enc aes-256-cbc, pbkdf2 sha256 600000 iterations, SERVA_BACKUP_PASSPHRASE"
  echo "encrypted_sha256=$enc_sha"
  echo "dump_sha256=$dump_sha"
  echo "tables=$tables"
  echo "rows=$rows"
  echo "fingerprint_sha256=$fingerprint"
  echo "---stats---"
  cat "$BACKUP_DIR/$name.stats.sorted.partial"
} > "$BACKUP_DIR/$name.manifest"
rm -f "$BACKUP_DIR/$name.stats.partial" "$BACKUP_DIR/$name.stats.sorted.partial"
chmod 600 "$BACKUP_DIR/$name".*

# Retention: newest first by name (the UTC time stamp sorts correctly); never the one just made
keep="${SERVA_BACKUP_KEEP:-14}"
[[ "$keep" =~ ^[0-9]+$ && "$keep" -ge 1 ]] || keep=14
mapfile -t old < <(find "$BACKUP_DIR" -maxdepth 1 -name 'serva-*.dump.enc' -printf '%f\n' | LC_ALL=C sort -r | tail -n +"$((keep + 1))")
for file in "${old[@]}"; do
  base="${file%.dump.enc}"
  [[ "$base" == "$name" ]] && continue
  rm -f "$BACKUP_DIR/$base.dump.enc" "$BACKUP_DIR/$base.dump.enc.sha256" "$BACKUP_DIR/$base.manifest"
  info "Retention: deleted $base (keeping the newest $keep)"
done

size="$(du -h "$BACKUP_DIR/$name.dump.enc" | cut -f1)"
ok "Backup saved in $((SECONDS - started))s: $BACKUP_DIR/$name.dump.enc ($size, $tables tables, $rows rows)"
echo "   Test it any time with: pnpm local:restore $BACKUP_DIR/$name.dump.enc"
