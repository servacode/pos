#!/usr/bin/env bash
# Creates the database roles and databases for local development and CI.
# Uses SUPERUSER_URL when set (e.g. in CI); otherwise connects as the local `postgres` OS user.
#
# Outside development (NODE_ENV=production or SERVA_ENV=production) the role passwords must be
# given in SERVA_OWNER_PASSWORD and SERVA_APP_PASSWORD; the development defaults are refused.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${NODE_ENV:-}" == "production" || "${SERVA_ENV:-}" == "production" ]]; then
  for name in SERVA_OWNER_PASSWORD SERVA_APP_PASSWORD; do
    value="${!name:-}"
    case "$value" in
      "" | serva_owner | serva_app | postgres)
        echo "Refusing to bootstrap: set $name to a real password outside development." >&2
        exit 1
        ;;
    esac
    if [[ ${#value} -lt 16 ]]; then
      echo "Refusing to bootstrap: $name must be at least 16 characters." >&2
      exit 1
    fi
  done
fi

OWNER_PASSWORD="${SERVA_OWNER_PASSWORD:-serva_owner}"
APP_PASSWORD="${SERVA_APP_PASSWORD:-serva_app}"

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
