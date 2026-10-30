#!/usr/bin/env bash
# pnpm local:logs [service…] — the last log lines of the local server, then follows them (Ctrl+C).
set -euo pipefail
# shellcheck source=scripts/local/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

preflight
load_env
dc ps -a
dc logs --tail "${SERVA_LOG_LINES:-100}" --follow "$@"
