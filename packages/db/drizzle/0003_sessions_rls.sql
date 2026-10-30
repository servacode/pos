-- Sessions under row-level security (it was the one store table without it), session families
-- with an absolute end, and an administrative status for stores.

CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended');--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "status" "tenant_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint

-- Existing rows: each session starts its own family; the absolute end is 90 days after creation.
ALTER TABLE "sessions" ADD COLUMN "family_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "absolute_expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "sessions" SET "family_id" = "id", "absolute_expires_at" = "created_at" + interval '90 days';--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "family_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "absolute_expires_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "sessions_family_idx" ON "sessions" USING btree ("tenant_id","family_id");--> statement-breakpoint

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sessions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- Refresh and logout know only the token. This returns the one session with that hash (owned by
-- serva_owner, so RLS does not hide it) and only the fields needed to pick its store.
CREATE FUNCTION session_find_by_hash(p_hash text)
RETURNS TABLE (
  id uuid, tenant_id uuid, user_id uuid, family_id uuid, expires_at timestamptz,
  absolute_expires_at timestamptz, revoked_at timestamptz, replaced_by uuid
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.tenant_id, s.user_id, s.family_id, s.expires_at, s.absolute_expires_at, s.revoked_at, s.replaced_by
  FROM sessions s
  WHERE s.token_hash = p_hash
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION session_find_by_hash(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION session_find_by_hash(text) TO serva_app;--> statement-breakpoint

-- Login also needs the store's status.
DROP FUNCTION auth_find_login(text);--> statement-breakpoint
CREATE FUNCTION auth_find_login(p_phone text)
RETURNS TABLE (
  user_id uuid, tenant_id uuid, password_hash text, status user_status, full_name text,
  tenant_status tenant_status
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.tenant_id, u.password_hash, u.status, u.full_name, t.status
  FROM users u
  JOIN tenants t ON t.id = u.tenant_id
  WHERE u.phone = p_phone AND u.password_hash IS NOT NULL
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_login(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_find_login(text) TO serva_app;
