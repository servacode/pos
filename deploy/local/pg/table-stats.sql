-- Fingerprint of a Serva database, compared between a backup and its restore (tab 16 › اختبار
-- الاستعادة). One line per table, «schema.table|rows|md5 of all rows», then a few lines about the
-- schema itself (row-level security, policies, grants). Run as a superuser, so row-level security
-- does not hide rows. Output settings are fixed so both sides print values the same way.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on
\pset footer off
SET TimeZone = 'UTC';
SET DateStyle = 'ISO, YMD';
SET IntervalStyle = 'postgres';
SET extra_float_digits = 3;
SET bytea_output = 'hex';

-- Every table holding rows outside the system schemas (partitions each on their own, partitioned
-- parents left out so no row counts twice): row count and an order-independent checksum
SELECT format(
  'SELECT %L || ''|'' || count(*) || ''|'' || md5(coalesce(string_agg(md5(t::text), '''' ORDER BY md5(t::text)), '''')) FROM %I.%I t',
  n.nspname || '.' || c.relname, n.nspname, c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\_%'
ORDER BY n.nspname, c.relname
\gexec

-- Tables with row-level security switched on (and forced)
SELECT 'meta:rls|' || count(*) || '|' || md5(coalesce(string_agg(
         n.nspname || '.' || c.relname || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity,
         ',' ORDER BY n.nspname, c.relname), ''))
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p') AND (c.relrowsecurity OR c.relforcerowsecurity);

-- The policies themselves
SELECT 'meta:policies|' || count(*) || '|' || md5(coalesce(string_agg(
         schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, ',')
           || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''),
         ',' ORDER BY schemaname, tablename, policyname), ''))
FROM pg_policies;

-- Table privileges per role (the app role must keep exactly its grants)
SELECT 'meta:grants|' || count(*) || '|' || md5(coalesce(string_agg(
         grantee || ':' || table_schema || '.' || table_name || ':' || privilege_type,
         ',' ORDER BY grantee, table_schema, table_name, privilege_type), ''))
FROM information_schema.role_table_grants
WHERE table_schema NOT IN ('pg_catalog', 'information_schema');

-- Functions and triggers (the audit and immutability rules live there)
SELECT 'meta:functions|' || count(*) || '|' || md5(coalesce(string_agg(
         n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(p.prosrc),
         ',' ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), ''))
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\_%';

SELECT 'meta:triggers|' || count(*) || '|' || md5(coalesce(string_agg(
         t.tgrelid::regclass::text || '.' || t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)),
         ',' ORDER BY t.tgrelid::regclass::text, t.tgname), ''))
FROM pg_trigger t
WHERE NOT t.tgisinternal;
