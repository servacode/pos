-- Security layer: runtime role grants, row-level security, login lookup, default plan.
-- Tables are owned by serva_owner (runs migrations, not subject to RLS).
-- The API connects as serva_app (NOBYPASSRLS), so every store table below is filtered by tenant.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'serva_app') THEN
    RAISE EXCEPTION 'Role serva_app is missing. Run scripts/db-bootstrap.sh (or create it) before migrating.';
  END IF;
END $$;--> statement-breakpoint

-- The store currently being served, set per transaction by withTenant(): set_config('app.tenant_id', ..., true)
CREATE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO serva_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_tenant() TO serva_app;--> statement-breakpoint

-- Platform tables: plans are readable; platform_users is not reachable by the store API at all.
GRANT SELECT ON plans TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tenants, subscriptions, tenant_settings, branches, registers, roles, users TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON user_roles TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT ON audit_logs TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON sessions TO serva_app;--> statement-breakpoint

-- Row-level security: a store sees and writes only its own rows.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenants
  USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());--> statement-breakpoint

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON subscriptions
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenant_settings
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON branches
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE registers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON registers
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON roles
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON user_roles
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON audit_logs
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- Login happens before the store is known. This function (owned by serva_owner, so it is not
-- filtered by RLS) returns only what login needs for one phone number, and nothing else.
CREATE FUNCTION auth_find_login(p_phone text)
RETURNS TABLE (user_id uuid, tenant_id uuid, password_hash text, status user_status, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.tenant_id, u.password_hash, u.status, u.full_name
  FROM users u
  WHERE u.phone = p_phone AND u.password_hash IS NOT NULL
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_login(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_find_login(text) TO serva_app;--> statement-breakpoint

-- Every new store starts on this plan. Its free period is edited from the platform admin panel.
INSERT INTO plans (code, name, is_free, is_default, trial_days, grace_days, limits, sort_order)
VALUES ('free', 'الباقة المجانية', true, true, 14, 7, '{}'::jsonb, 0)
ON CONFLICT (code) DO NOTHING;
