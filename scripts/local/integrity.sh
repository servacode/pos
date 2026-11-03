#!/usr/bin/env bash
# pnpm local:integrity [--store=<code>] [--json] — «فحص السلامة» of the local server's books
# (task M0-5): every entry balanced, no gap in the entry numbers, stock = its movements, drawers
# and the day report = the ledger. Read only: it corrects nothing. Exit 1 when a problem is found.
set -euo pipefail
# shellcheck source=scripts/local/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env
postgres_running || die "The database is not running. Start the server first: pnpm local:up"
command -v pnpm > /dev/null 2>&1 || die "pnpm is needed for this check (see «التثبيت أول مرة»)."
[[ -d "$ROOT_DIR/node_modules" ]] || (cd "$ROOT_DIR" && pnpm install --frozen-lockfile)
DATABASE_MIGRATION_URL="postgres://serva_owner:${SERVA_OWNER_PASSWORD}@127.0.0.1:${SERVA_PG_PORT:-5433}/serva" \
  pnpm --silent --dir "$ROOT_DIR" --filter @serva/api integrity "$@"
