#!/usr/bin/env bash
# Creates the database roles and databases for local development and CI.
# Uses SUPERUSER_URL when set (e.g. in CI); otherwise connects as the local `postgres` OS user.
set -euo pipefail

OWNER_PASSWORD="${SERVA_OWNER_PASSWORD:-serva_owner}"
APP_PASSWORD="${SERVA_APP_PASSWORD:-serva_app}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -n "${SUPERUSER_URL:-}" ]]; then
  PSQL=(psql "$SUPERUSER_URL")
elif [[ "$(id -u)" == "0" ]]; then
  PSQL=(sudo -u postgres psql)
else
  PSQL=(psql -U postgres)
fi

"${PSQL[@]}" -v ON_ERROR_STOP=1 -v owner_password="$OWNER_PASSWORD" -v app_password="$APP_PASSWORD" \
  -f "$SCRIPT_DIR/db-bootstrap.sql"
echo "Database roles and databases are ready."
