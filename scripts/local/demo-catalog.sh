#!/usr/bin/env bash
# bash scripts/local/demo-catalog.sh [store code] — adds the demo catalog (about 40 products of a
# Raqqa supermarket, with barcodes, prices and stock) to a store on the running local server. The
# store code is needed only when the server has more than one store. Running it twice adds nothing.
set -euo pipefail
# shellcheck source=scripts/local/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

preflight
load_env
args=(node dist/scripts/seed.js --demo-catalog)
if [[ -n "${1:-}" ]]; then args+=("--store=$1"); fi
dc run --rm --no-deps migrate "${args[@]}"
ok "Demo catalog ready."
