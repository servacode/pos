#!/usr/bin/env bash
# pnpm local:deploy — puts the current code on the local server:
#   1. builds the API and web images from this checkout;
#   2. backs up the database first, when it already holds data (tab 16: a backup before every
#      release that may change the database);
#   3. migrates (the one-shot migrate service) and restarts what changed;
#   4. runs the smoke test, which fails loudly.
# Set SERVA_SKIP_PREDEPLOY_BACKUP=1 to skip step 2 (not recommended).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/local/lib.sh
source "$SCRIPT_DIR/lib.sh"

started=$SECONDS
preflight
ensure_env
load_env
export_lan_ips

info "1/4 Building the images (from $(git -C "$ROOT_DIR" rev-parse --short HEAD 2> /dev/null || echo 'this folder'))…"
dc build api web || die "Build failed: the code does not compile into an image. Nothing was changed on the server."

if [[ "${SERVA_SKIP_PREDEPLOY_BACKUP:-}" == "1" ]]; then
  warn "2/4 Skipping the pre-deploy backup (SERVA_SKIP_PREDEPLOY_BACKUP=1)."
elif postgres_running && [[ "$(dc exec -T -u postgres postgres psql -X -tA -d serva \
  -c "select count(*) from pg_tables where schemaname = 'public'" 2> /dev/null || echo 0)" -gt 0 ]]; then
  info "2/4 Backing up the database before changing anything…"
  bash "$SCRIPT_DIR/backup.sh" --label pre-deploy || die "The pre-deploy backup failed, so nothing was deployed."
else
  info "2/4 No existing database yet: nothing to back up."
fi

info "3/4 Migrating and restarting…"
# `up` runs the one-shot services (certs, migrate) again; the API and web containers are recreated
# when their image changed, after the migrations succeeded.
dc up -d --wait --wait-timeout "${SERVA_WAIT_TIMEOUT:-300}" --remove-orphans ||
  {
    dc ps -a >&2 || true
    dc logs --tail 80 migrate api web >&2 || true
    banner "$C_RED" "DEPLOY FAILED: the server did not become healthy." "فشل النشر: راجع السجلات أعلاه."
    exit 1
  }
after_up

info "4/4 Smoke test…"
bash "$SCRIPT_DIR/smoke.sh"

banner "$C_GREEN" "DEPLOYED in $((SECONDS - started))s" "تم النشر بنجاح."
print_addresses
