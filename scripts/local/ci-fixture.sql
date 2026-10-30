-- Test data for the restore drill in CI (.github/workflows/local-server.yml): stores, settings and
-- branches with Arabic text, arrays, JSON and NULLs, so a restore that loses or changes anything
-- shows up in the per-table checksums. Run as the postgres superuser on the local server's database:
--   docker compose -f deploy/local/compose.yml exec -T postgres psql -U postgres -d serva < scripts/local/ci-fixture.sql
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO tenants (name, legal_name, sectors, timezone)
SELECT 'متجر الاختبار ' || g, CASE WHEN g % 3 = 0 THEN NULL ELSE 'شركة رقم ' || g || ' المحدودة' END,
       ARRAY['grocery', 'bakery'], 'Asia/Damascus'
FROM generate_series(1, 25) AS g;

INSERT INTO tenant_settings (tenant_id, base_currency, enabled_currencies, receipt_footer, cash_rounding_steps)
SELECT id, 'SYP', ARRAY['SYP', 'USD'], 'شكراً لزيارتكم «' || name || '»', '{"SYP": 1000, "USD": 25}'::jsonb
FROM tenants WHERE name LIKE 'متجر الاختبار %';

INSERT INTO branches (tenant_id, code, name, address, phone)
SELECT t.id, 'B' || b, 'فرع ' || b, CASE WHEN b = 2 THEN NULL ELSE 'الرقة، شارع ' || b END, '+9639' || lpad((b * 1000)::text, 8, '0')
FROM tenants t CROSS JOIN generate_series(1, 4) AS b
WHERE t.name LIKE 'متجر الاختبار %';
COMMIT;

SELECT (SELECT count(*) FROM tenants) AS tenants, (SELECT count(*) FROM branches) AS branches;
