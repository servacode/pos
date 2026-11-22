#!/usr/bin/env bash
# pnpm local:offsite <upload <name> | list | fetch <name|latest> | test> — the off-site copy in an
# S3-compatible bucket (Backblaze B2, Wasabi, Cloudflare R2, MinIO, AWS S3…). Off unless
# SERVA_S3_BUCKET is set. backup.sh calls "upload" after every verified backup.
#
# Settings (deploy/local/.env):
#   SERVA_S3_ENDPOINT           https://s3.us-west-004.backblazeb2.com, https://<id>.r2.cloudflarestorage.com …
#   SERVA_S3_BUCKET             the bucket (it must exist; the key needs read, write and delete in it)
#   SERVA_S3_ACCESS_KEY_ID      the key
#   SERVA_S3_SECRET_ACCESS_KEY  its secret
#   SERVA_S3_PREFIX             folder inside the bucket (default: serva-backups)
#   SERVA_S3_REGION             only if the provider asks for one (R2: auto)
#   SERVA_S3_KEEP               copies kept in the bucket (default 30); older ones are deleted
#   SERVA_S3_DOCKER_NETWORK     a Docker network to join, for a MinIO running in Docker on this computer (http://minio:9000)
#   SERVA_S3_VERIFY             download (default): the uploaded file is read back and its sha256 compared;
#                               size: only the sizes are compared (no download, for metered links)
#
# The tool is rclone, in its official image, pinned by version and digest below and run with
# docker like the rest of the stack (read-only file system, no capabilities, not root). Why rclone:
# one binary that speaks to every S3-compatible provider with one set of options, verifies what it
# transfers, and needs nothing installed on this computer. aws-cli v2.23+ sends checksum headers
# some of these providers still reject, and its image is far larger.
#
# What is uploaded is what backup.sh made: the encrypted dump, its .sha256 and its manifest. The
# bucket never sees the data in clear, nor the passphrase.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/local/lib.sh
source "$SCRIPT_DIR/lib.sh"
# shellcheck source=scripts/local/alert.sh
source "$SCRIPT_DIR/alert.sh"

RCLONE_IMAGE="${SERVA_RCLONE_IMAGE:-rclone/rclone:1.69.3@sha256:1f497a86a6466395e62a5886613a14b7b18809543566ef9fa35fa1371a7ecc0f}"

s3_enabled() { [[ -n "${SERVA_S3_BUCKET:-}" ]]; }

# Everything needed is set, and the endpoint is not sent over plain http across the internet
s3_check_config() {
  local missing=() var
  for var in SERVA_S3_ENDPOINT SERVA_S3_BUCKET SERVA_S3_ACCESS_KEY_ID SERVA_S3_SECRET_ACCESS_KEY; do
    [[ -n "${!var:-}" ]] || missing+=("$var")
  done
  ((${#missing[@]} == 0)) || die "OFF-SITE UPLOAD FAILED: ${missing[*]} missing in $ENV_FILE."
  transport_ok "$SERVA_S3_ENDPOINT" || die "OFF-SITE UPLOAD FAILED: SERVA_S3_ENDPOINT must be https:// (http:// only on the shop network)."
  [[ "${SERVA_S3_BUCKET}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$ ]] || die "OFF-SITE UPLOAD FAILED: SERVA_S3_BUCKET is not a valid bucket name."
  s3_prefix="${SERVA_S3_PREFIX:-serva-backups}"
  s3_prefix="${s3_prefix#/}"
  s3_prefix="${s3_prefix%/}"
  [[ "$s3_prefix" =~ ^[A-Za-z0-9._/-]+$ && "$s3_prefix" != *..* ]] || die "OFF-SITE UPLOAD FAILED: SERVA_S3_PREFIX may only hold letters, digits, . _ - and /."
  s3_keep="${SERVA_S3_KEEP:-30}"
  [[ "$s3_keep" =~ ^[0-9]+$ && "$s3_keep" -ge 1 ]] || s3_keep=30
  s3_remote="serva:$SERVA_S3_BUCKET/$s3_prefix"
}

# rclone in its container. $1 is how the backup folder is mounted: ro or rw. The remote is described
# by RCLONE_CONFIG_SERVA_* variables, so no config file (and no secret) is ever written to disk;
# the two secrets are passed by name, not value, so they do not show in the process list.
rclone_run() {
  local mode="$1"
  shift
  export RCLONE_CONFIG_SERVA_TYPE=s3 RCLONE_CONFIG_SERVA_PROVIDER=Other \
    RCLONE_CONFIG_SERVA_ENDPOINT="$SERVA_S3_ENDPOINT" \
    RCLONE_CONFIG_SERVA_ACCESS_KEY_ID="$SERVA_S3_ACCESS_KEY_ID" \
    RCLONE_CONFIG_SERVA_SECRET_ACCESS_KEY="$SERVA_S3_SECRET_ACCESS_KEY" \
    RCLONE_CONFIG_SERVA_REGION="${SERVA_S3_REGION:-}" \
    RCLONE_CONFIG_SERVA_NO_CHECK_BUCKET=true
  docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    ${SERVA_S3_DOCKER_NETWORK:+--network "$SERVA_S3_DOCKER_NETWORK"} \
    --memory 512m --pids-limit 128 --user "$(id -u):$(id -g)" \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    -e HOME=/tmp -e RCLONE_CONFIG=/tmp/rclone.conf -e RCLONE_LOG_LEVEL=ERROR \
    -e RCLONE_CONFIG_SERVA_TYPE -e RCLONE_CONFIG_SERVA_PROVIDER -e RCLONE_CONFIG_SERVA_ENDPOINT \
    -e RCLONE_CONFIG_SERVA_ACCESS_KEY_ID -e RCLONE_CONFIG_SERVA_SECRET_ACCESS_KEY \
    -e RCLONE_CONFIG_SERVA_REGION -e RCLONE_CONFIG_SERVA_NO_CHECK_BUCKET \
    -v "$BACKUP_DIR:/data:$mode" "$RCLONE_IMAGE" "$@"
}

fail_upload() { die "OFF-SITE UPLOAD FAILED: $* The local backup is saved."; }

upload() {
  local name="${1:?Usage: offsite-s3.sh upload <backup name>}" ext size remote_size sha remote_sha enc_sha
  [[ "$name" =~ ^serva-[0-9TZ]{16}(-[a-z0-9-]{1,32})?$ ]] || die "Not a backup name: $name"
  for ext in dump.enc dump.enc.sha256 manifest; do
    [[ -s "$BACKUP_DIR/$name.$ext" ]] || die "OFF-SITE UPLOAD FAILED: $BACKUP_DIR/$name.$ext is missing."
  done
  s3_check_config
  enc_sha="$(sha256sum < "$BACKUP_DIR/$name.dump.enc" | cut -d' ' -f1)"
  info "Uploading $name to the bucket ($SERVA_S3_BUCKET/$s3_prefix)…"
  # The manifest goes last: a copy that has one is complete
  for ext in dump.enc dump.enc.sha256 manifest; do
    rclone_run ro copyto "/data/$name.$ext" "$s3_remote/$name.$ext" > /dev/null ||
      fail_upload "could not write $name.$ext to the bucket (wrong key, bucket or endpoint? Run: pnpm local:offsite test)."
  done
  # Verify: every file is there with the same size…
  local listing
  listing="$(rclone_run ro lsf --files-only --format "sp" --separator ' ' --include "$name.*" "$s3_remote")" ||
    fail_upload "could not list the bucket to verify the upload."
  for ext in dump.enc dump.enc.sha256 manifest; do
    size="$(stat -c %s "$BACKUP_DIR/$name.$ext")"
    remote_size="$(awk -v f="$name.$ext" '$2 == f { print $1 }' <<< "$listing")"
    [[ "$remote_size" == "$size" ]] || fail_upload "$name.$ext is $remote_size bytes in the bucket, expected $size."
  done
  # …and the encrypted dump read back from the bucket has the same sha256
  if [[ "${SERVA_S3_VERIFY:-download}" != size ]]; then
    sha="$(rclone_run ro hashsum sha256 --download "$s3_remote/$name.dump.enc")" ||
      fail_upload "could not read $name.dump.enc back from the bucket."
    remote_sha="${sha%% *}"
    [[ "$remote_sha" == "$enc_sha" ]] || fail_upload "$name.dump.enc in the bucket does not match the backup (sha256)."
  fi
  printf '%s %s\n' "$(date -u +%Y%m%dT%H%M%SZ)" "$name" > "$BACKUP_DIR/last-s3"

  # Retention: the newest SERVA_S3_KEEP backups stay (the one just made is always among them)
  local file base
  while IFS= read -r file; do
    base="${file%.dump.enc}"
    [[ "$base" == "$name" ]] && continue
    for ext in dump.enc dump.enc.sha256 manifest; do
      rclone_run ro deletefile "$s3_remote/$base.$ext" > /dev/null 2>&1 || true
    done
    info "Bucket retention: deleted $base (keeping the newest $s3_keep)"
  done < <(rclone_run ro lsf --files-only --include 'serva-*.dump.enc' "$s3_remote" | LC_ALL=C sort -r | tail -n +"$((s3_keep + 1))")
  ok "Bucket copy verified (${SERVA_S3_VERIFY:-download}): $s3_remote/$name.dump.enc"
}

list() {
  s3_check_config
  rclone_run ro lsf --files-only --format "sp" --separator ' ' --include 'serva-*.dump.enc' "$s3_remote" |
    LC_ALL=C sort -k2 | awk '{ printf "%s  %.1f MB\n", $2, $1 / 1048576 }'
}

# Downloads a backup (the three files) into the backup folder, checks it, and says how to restore it
fetch() {
  local want="${1:?Usage: offsite-s3.sh fetch <backup name | latest>}" name ext manifest_sha dump_sha
  s3_check_config
  if [[ "$want" == latest ]]; then
    name="$(rclone_run ro lsf --files-only --include 'serva-*.dump.enc' "$s3_remote" | LC_ALL=C sort | tail -n 1)"
    [[ -n "$name" ]] || die "The bucket holds no backup under $s3_remote."
    name="${name%.dump.enc}"
  else
    name="${want%.dump.enc}"
    name="${name%.manifest}"
  fi
  [[ "$name" =~ ^serva-[0-9TZ]{16}(-[a-z0-9-]{1,32})?$ ]] || die "Not a backup name: $want"
  mkdir -p "$BACKUP_DIR"
  partial_prefix="$BACKUP_DIR/$name"
  trap 'rm -f "$partial_prefix".*.partial' EXIT
  for ext in dump.enc dump.enc.sha256 manifest; do
    rclone_run rw copyto "$s3_remote/$name.$ext" "/data/$name.$ext.partial" > /dev/null ||
      die "Could not download $name.$ext from the bucket."
  done
  dump_sha="$(sha256sum < "$BACKUP_DIR/$name.dump.enc.partial" | cut -d' ' -f1)"
  manifest_sha="$(sed -n 's/^encrypted_sha256=//p' "$BACKUP_DIR/$name.manifest.partial")"
  [[ "$dump_sha" == "$manifest_sha" && "$dump_sha" == "$(cut -d' ' -f1 "$BACKUP_DIR/$name.dump.enc.sha256.partial")" ]] ||
    die "The downloaded $name does not match its checksum: do not use it. Try an older copy (pnpm local:offsite list)."
  for ext in dump.enc dump.enc.sha256 manifest; do mv "$BACKUP_DIR/$name.$ext.partial" "$BACKUP_DIR/$name.$ext"; done
  chmod 600 "$BACKUP_DIR/$name".*
  trap - EXIT
  ok "Downloaded and verified: $BACKUP_DIR/$name.dump.enc"
  echo "   Now: pnpm local:restore $BACKUP_DIR/$name.dump.enc   (add --replace-live to use it)"
}

# A small file is written, listed and deleted: proves the key, the bucket and the endpoint work
test_bucket() {
  s3_check_config
  local probe=".serva-probe-$$"
  printf 'serva probe\n' > "$BACKUP_DIR/$probe"
  probe_file="$BACKUP_DIR/$probe"
  trap 'rm -f "$probe_file"' EXIT
  rclone_run ro copyto "/data/$probe" "$s3_remote/$probe" > /dev/null || die "Cannot write to $s3_remote (key, bucket or endpoint is wrong)."
  rclone_run ro lsf --files-only --include "$probe" "$s3_remote" | grep -qxF "$probe" || die "Wrote to $s3_remote but cannot list it back."
  rclone_run ro deletefile "$s3_remote/$probe" > /dev/null || warn "Cannot delete from $s3_remote: retention will not work (the key needs delete rights)."
  ok "The bucket works: write, list and delete on $s3_remote"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  load_env
  s3_enabled || die "SERVA_S3_BUCKET is not set in $ENV_FILE: the S3 off-site copy is off."
  command -v docker > /dev/null || die "Docker is not installed."
  case "${1:-}" in
    upload) upload "${2:-}" ;;
    list) list ;;
    fetch) fetch "${2:-}" ;;
    test) test_bucket ;;
    *) die "Usage: pnpm local:offsite upload <name> | list | fetch <name|latest> | test" ;;
  esac
fi
