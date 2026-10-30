#!/usr/bin/env bash
# pnpm local:down — stops the local server. The data stays in its volume; `pnpm local:up` brings
# everything back as it was.
set -euo pipefail
# shellcheck source=scripts/local/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

preflight
load_env
info "Stopping the Serva local server (data is kept)…"
dc down --remove-orphans
ok "Stopped. Start again with: pnpm local:up"
