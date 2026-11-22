#!/usr/bin/env bash
# pnpm local:backup [--label <word>] — an encrypted, timestamped backup of the local server's
# database, in deploy/local/backups (or SERVA_BACKUP_DIR):
#   serva-<UTC time>[-label].dump.enc         pg_dump custom format, AES-256 (SERVA_BACKUP_PASSPHRASE)
#   serva-<UTC time>[-label].dump.enc.sha256  checksum of the encrypted file (sha256sum -c)
#   serva-<UTC time>[-label].manifest         what restore checks: dump checksum, rows and checksum
#                                              per table, all from the same snapshot as the dump
# Keeps the newest SERVA_BACKUP_KEEP backups (default 14) and deletes older ones.
#
# Off-site in a bucket (S3-compatible: Backblaze B2, Wasabi, Cloudflare R2, MinIO…): with
# SERVA_S3_BUCKET set, the same three files are uploaded after the local copy is verified, read
# back and checked (size and sha256), and the newest SERVA_S3_KEEP kept (scripts/local/offsite-s3.sh).
# A failed upload fails the backup the same way.
#
# Alerts: with SERVA_ALERT_WEBHOOK_URL set, a failed backup, verification or upload sends a message
# (scripts/local/alert.sh). SERVA_BACKUP_PING_URL, if set, is called after a fully successful run
# (a dead-man's switch such as healthchecks.io: it alarms when the computer was off and no run came).
#
# Off-site (task M0-6, ADR-0014): with SERVA_OFFSITE_DIR set (an external disk, or a folder a
# cloud service keeps in sync, e.g. Google Drive or OneDrive), the three files are copied there,
# their checksum verified at the destination, and the newest SERVA_OFFSITE_KEEP (default 30) kept.
# The copy is encrypted like the original: the folder never sees the data in clear. A failed copy
# fails the backup (exit 1), so a scheduled run reports it, but the local backup is kept.
#
# This is the local-server tool. The hosted server uses pgBackRest with continuous archiving and an
# off-site copy (tab 16 › النسخ الاحتياطي والاستعادة).
set -euo pipefail
# shellcheck source=scripts/local/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
# shellcheck source=scripts/local/alert.sh
source "$(dirname "${BASH_SOURCE[0]}")/alert.sh"

label=""
while (($# > 0)); do
  case "$1" in
    --label)
      label="${2:?--label needs a word}"
      shift 2
      ;;
    -h | --help)
      sed -n '2,22p' "$0"
      exit 0
      ;;
    *) die "Unknown option: $1 (usage: pnpm local:backup [--label <word>])" ;;
  esac
done
[[ -z "$label" || "$label" =~ ^[a-z0-9-]{1,32}$ ]] || die "The label may only hold a-z, 0-9 and '-'."

name="" work=""
SERVA_ERROR_FILE="$(mktemp)"
export SERVA_ERROR_FILE
# Whatever stops the run (a die, or a command failing under set -e) sends one alert and cleans up
on_exit() {
  local rc=$?
  trap - EXIT
  rm -f "$SERVA_ERROR_FILE"
  if [[ -n "$work" ]]; then dc exec -T -u postgres postgres rm -rf "$work" > /dev/null 2>&1 || true; fi
  if [[ -n "$name" && -n "${BACKUP_DIR:-}" ]]; then rm -f "$BACKUP_DIR/$name".*.partial; fi
  if ((rc != 0)); then
    send_alert "BACKUP ALERT: ${SERVA_LAST_ERROR:-the backup script stopped unexpectedly (exit $rc).} Look at $BACKUP_DIR/daily.log on that computer." || true
  fi
  exit "$rc"
}
load_env
trap on_exit EXIT
preflight
passphrase="${SERVA_BACKUP_PASSPHRASE:-}"
[[ ${#passphrase} -ge 16 ]] || die "SERVA_BACKUP_PASSPHRASE is missing in $ENV_FILE."
postgres_running || die "The database is not running. Start the server first: pnpm local:up"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="serva-$stamp${label:+-$label}"
work="/tmp/serva-backup-$stamp-$$"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

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

# ─── Off-site copies ───────────────────────────────────────────────────────────────────────────
# Two independent kinds, both optional: a folder (an external disk, or one a cloud client syncs)
# and a bucket (S3-compatible). Either failing fails the run, after the other was still tried.
offsite="${SERVA_OFFSITE_DIR:-}"
failed=""
if [[ -z "$offsite" && -z "${SERVA_S3_BUCKET:-}" ]]; then
  warn "No off-site copy: neither SERVA_OFFSITE_DIR nor SERVA_S3_BUCKET is set (docs/local-server.md). A fire or a theft would take the backups with the computer."
fi

if [[ -n "$offsite" ]]; then
  # In a subshell: its die only ends the subshell, so the bucket upload below still runs
  (
    set -euo pipefail
    [[ "$offsite" == /* ]] || offsite="$ROOT_DIR/$offsite"
    if ! mkdir -p "$offsite" 2> /dev/null || [[ ! -w "$offsite" ]]; then
      die "OFF-SITE COPY FAILED: cannot write to $offsite (is the disk plugged in, the folder synced?). The local backup is saved."
    fi
    case "$(cd "$offsite" && pwd -P)/" in
      "$(cd "$BACKUP_DIR" && pwd -P)/"*) die "OFF-SITE COPY FAILED: SERVA_OFFSITE_DIR is inside the backup folder: that is not off-site." ;;
    esac
    for ext in dump.enc dump.enc.sha256 manifest; do
      cp "$BACKUP_DIR/$name.$ext" "$offsite/$name.$ext.partial" ||
        die "OFF-SITE COPY FAILED while writing $offsite (disk full?). The local backup is saved."
    done
    if [[ "$(sha256sum < "$offsite/$name.dump.enc.partial" | cut -d' ' -f1)" != "$enc_sha" ]]; then
      rm -f "$offsite/$name".*.partial
      die "OFF-SITE COPY FAILED: the copy in $offsite does not match the backup. The local backup is saved."
    fi
    # (no set -e inside "( … ) ||": every step that can fail checks itself)
    for ext in dump.enc dump.enc.sha256 manifest; do
      mv "$offsite/$name.$ext.partial" "$offsite/$name.$ext" || die "OFF-SITE COPY FAILED while finishing the copy in $offsite."
    done
    printf '%s %s\n' "$stamp" "$offsite/$name.dump.enc" > "$BACKUP_DIR/last-offsite" || die "OFF-SITE COPY FAILED: cannot write $BACKUP_DIR/last-offsite."

    offsite_keep="${SERVA_OFFSITE_KEEP:-30}"
    [[ "$offsite_keep" =~ ^[0-9]+$ && "$offsite_keep" -ge 1 ]] || offsite_keep=30
    mapfile -t old < <(find "$offsite" -maxdepth 1 -name 'serva-*.dump.enc' -printf '%f\n' | LC_ALL=C sort -r | tail -n +"$((offsite_keep + 1))")
    for file in "${old[@]}"; do
      base="${file%.dump.enc}"
      [[ "$base" == "$name" ]] && continue
      rm -f "$offsite/$base.dump.enc" "$offsite/$base.dump.enc.sha256" "$offsite/$base.manifest"
    done
    ok "Off-site copy verified: $offsite/$name.dump.enc"
  ) || failed="folder"
fi

if [[ -n "${SERVA_S3_BUCKET:-}" ]]; then
  bash "$(dirname "${BASH_SOURCE[0]}")/offsite-s3.sh" upload "$name" || failed="${failed:+$failed and }bucket"
fi

if [[ -n "$failed" ]]; then
  # The reasons the folder copy and the upload gave, one per line
  reasons="$(tr '\n' ' ' < "$SERVA_ERROR_FILE")"
  SERVA_LAST_ERROR="OFF-SITE COPY FAILED ($failed): the backup $name is saved on the computer but not off-site. ${reasons}"
  exit 1
fi

# Everything worked: tell the dead-man's switch, if there is one (its URL is a secret: not printed)
if [[ -n "${SERVA_BACKUP_PING_URL:-}" ]]; then
  printf 'url = %s\n' "$(alert_curl_quote "$SERVA_BACKUP_PING_URL")" |
    curl --silent --fail --max-time 15 --retry 2 --output /dev/null --config - 2> /dev/null ||
    warn "The success ping (SERVA_BACKUP_PING_URL) was not accepted."
fi
