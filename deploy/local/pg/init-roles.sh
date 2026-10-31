#!/usr/bin/env bash
# Runs inside the postgres container, once, when the data volume is empty
# (/docker-entrypoint-initdb.d). Creates the serva_owner and serva_app roles and the databases with
# scripts/db-bootstrap.sql, using the generated passwords from deploy/local/.env.
set -euo pipefail

for name in SERVA_OWNER_PASSWORD SERVA_APP_PASSWORD; do
  value="${!name:-}"
  if [[ ${#value} -lt 16 ]]; then
    echo "init-roles: $name must be set to at least 16 characters (deploy/local/.env)." >&2
    exit 1
  fi
done

psql --no-psqlrc -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_password="$SERVA_OWNER_PASSWORD" -v app_password="$SERVA_APP_PASSWORD" \
  -f /serva/bootstrap.sql
echo "init-roles: roles and databases are ready."
