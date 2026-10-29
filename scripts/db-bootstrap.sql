-- Creates the two database roles and the dev/test databases.
-- Run once as a PostgreSQL superuser (see scripts/db-bootstrap.sh). Safe to re-run.
--   serva_owner: owns the tables and runs migrations. Not subject to row-level security.
--   serva_app:   used by the API at runtime. Subject to row-level security (NOBYPASSRLS).
-- Default passwords for local development when not passed with -v (e.g. the docker-compose init).
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

SELECT 'CREATE DATABASE serva OWNER serva_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'serva') \gexec

SELECT 'CREATE DATABASE serva_test OWNER serva_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'serva_test') \gexec
