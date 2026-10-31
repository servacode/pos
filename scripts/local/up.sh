#!/usr/bin/env bash
# pnpm local:up — starts the local server (builds the images the first time) and waits until every
# service is healthy. Creates deploy/local/.env with random secrets on the very first run.
set -euo pipefail
# shellcheck source=scripts/local/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

preflight
ensure_env
load_env
export_lan_ips

info "Starting the Serva local server…"
dc up -d --wait --wait-timeout "${SERVA_WAIT_TIMEOUT:-300}" ||
  {
    dc ps -a >&2 || true
    die "The server did not start. Run 'pnpm local:logs' (or see docs/local-server.md › إذا حدثت مشكلة)."
  }
after_up
ok "Serva is running."
print_addresses
