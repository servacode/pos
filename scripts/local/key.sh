#!/usr/bin/env bash
# pnpm local:key <split | combine [--set-env] <part> <part>> — the backup key in three parts, any
# two of which open the backups (ADR-0014, owner's note 1; task M0-6). scripts/local/key-split.mjs
# does the arithmetic.
#
#   split     prints the three parts of SERVA_BACKUP_PASSPHRASE (deploy/local/.env): one for the
#             owner, one for Serva, one on paper. Nothing is written to disk.
#   combine   gives the key back from any two parts. With --set-env it is written into
#             deploy/local/.env (the previous file kept as .env.before-key-<time>), which is how a
#             new computer gets the key to restore the old backups.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/local/lib.sh
source "$SCRIPT_DIR/lib.sh"

command -v node > /dev/null 2>&1 || die "Node.js is needed (it comes with the pnpm setup)."

split() {
  load_env
  [[ ${#SERVA_BACKUP_PASSPHRASE} -ge 16 ]] || die "SERVA_BACKUP_PASSPHRASE is missing in $ENV_FILE."
  node "$SCRIPT_DIR/key-split.mjs" split
  banner "$C_YELLOW" \
    "Keep the three parts in three different places, none of them on this computer." \
    "Any two open the backups; one alone cannot." \
    "احفظ الأجزاء الثلاثة في ثلاثة أماكن مختلفة. أي جزأين يفتحان النسخ، وجزء واحد لا يكفي."
}

combine() {
  local set_env="" parts=()
  while (($# > 0)); do
    case "$1" in
      --set-env) set_env=1 ;;
      *) parts+=("$1") ;;
    esac
    shift
  done
  local key
  key="$(node "$SCRIPT_DIR/key-split.mjs" combine "${parts[@]}")" || exit 1
  if [[ -z "$set_env" ]]; then
    ok "Key recovered. Put it in $ENV_FILE as SERVA_BACKUP_PASSPHRASE=… or run again with --set-env."
    printf '%s\n' "$key"
    return
  fi
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE does not exist yet: run pnpm local:up once first."
  local backup tmp
  backup="$ENV_FILE.before-key-$(date -u +%Y%m%dT%H%M%SZ)"
  tmp="$ENV_FILE.tmp.$$"
  (
    umask 077
    cp "$ENV_FILE" "$backup"
    awk -v key="$key" '
      /^SERVA_BACKUP_PASSPHRASE=/ { print "SERVA_BACKUP_PASSPHRASE=" key; done = 1; next }
      { print }
      END { if (!done) print "SERVA_BACKUP_PASSPHRASE=" key }
    ' "$ENV_FILE" > "$tmp"
  )
  mv "$tmp" "$ENV_FILE"
  ok "Backup key written to $ENV_FILE (the previous file is kept as $backup)."
  echo "   Restore the old backups with: pnpm local:restore <backup.dump.enc>"
}

case "${1:-}" in
  split) split ;;
  combine)
    shift
    combine "$@"
    ;;
  *) die "Usage: pnpm local:key split | combine [--set-env] <part> <part>" ;;
esac
