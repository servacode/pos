-- Creates the two database roles and the dev/test databases.
-- Run once as a PostgreSQL superuser (see scripts/db-bootstrap.sh). Safe to re-run.
--   serva_owner: owns the tables and runs migrations. Not subject to RLS.
--   serva_app:   used by the API at runtime. Subject to row-level security (NOBYPASSRLS).
-- Default passwords for local development only, when not passed with -v (e.g. the docker-compose
-- init). db-bootstrap.sh refuses them when NODE_ENV=production.
\if :{?owner_password}
\else
  \set owner_password serva_owner
\endif
\if :{?app_password}
\else
  \set app_password serva_app
\endif

SELECT format('CREATE ROLE serva_owner LOGIN PASSWORD %L', :'owner_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'serva_owner') \gexec

SELECT format('CREATE ROLE serva_app LOGIN NOBYPASSRLS PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'serva_app') \gexec

-- Timeouts (09: every role): a stuck query, a forgotten open transaction or a lock queue cannot
-- hold connections and locks for long. The API also sets them on its own connections.
ALTER ROLE serva_app SET statement_timeout = '15s';
ALTER ROLE serva_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE serva_app SET lock_timeout = '5s';
-- The owner runs migrations, which may legitimately run long: no statement timeout, but DDL waits
-- at most 5s for a lock (the migrator sets the same) and an idle open transaction is ended.
ALTER ROLE serva_owner SET lock_timeout = '5s';
ALTER ROLE serva_owner SET idle_in_transaction_session_timeout = '60s';

SELECT 'CREATE DATABASE serva OWNER serva_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'serva') \gexec

SELECT 'CREATE DATABASE serva_test OWNER serva_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'serva_test') \gexec
