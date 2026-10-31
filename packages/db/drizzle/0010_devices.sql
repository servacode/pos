-- Linking devices (17 › الأجهزة; 09 › device_pairings، devices; 16 › زرع جهاز في المتجر):
--   * tenants.store_code, the public 6-digit code typed with a manual pairing code;
--   * device_pairings: QR token and manual code, both hashed, 10 minutes, 5 wrong tries;
--   * devices wait for the owner's approval (pending_approval, no code, no token), poll with a
--     hashed secret, and take their 3-digit code on approval; the allowed status changes are
--     enforced by a trigger, so a revoked device can never come back, even by hand;
--   * heartbeat columns (unsent count, storage); the last number per series stays in doc_sequences;
--   * SECURITY DEFINER lookups by hash for the steps that run before the store is known;
--   * devices.view and devices.manage in the existing stores' system roles.

-- ─── tenants.store_code ──────────────────────────────────────────────────────
-- Random and unique across the platform. SECURITY DEFINER: a store cannot see the others' codes.
CREATE FUNCTION tenant_new_store_code() RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text;
BEGIN
  FOR i IN 1..100 LOOP
    -- 32 bits from gen_random_uuid() (a strong random source), reduced to 6 digits.
    v_code := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 1000000)::text, 6, '0');
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE store_code = v_code) THEN
      RETURN v_code;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'no free store code found';
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenant_new_store_code() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenant_new_store_code() TO serva_app;--> statement-breakpoint

ALTER TABLE "tenants" ADD COLUMN "store_code" text;--> statement-breakpoint
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT id FROM tenants WHERE store_code IS NULL LOOP
    UPDATE tenants SET store_code = tenant_new_store_code() WHERE id = t.id;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "store_code" SET DEFAULT tenant_new_store_code();--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "store_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_store_code_unique" UNIQUE("store_code");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_store_code_check" CHECK ("store_code" ~ '^[0-9]{6}$');--> statement-breakpoint

-- A device typing a manual code gives the store code first. Returns that store and its state only.
CREATE FUNCTION tenant_find_by_store_code(p_code text)
RETURNS TABLE (id uuid, name text, status tenant_status)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.name, t.status FROM tenants t WHERE t.store_code = p_code
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenant_find_by_store_code(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenant_find_by_store_code(text) TO serva_app;--> statement-breakpoint

-- ─── devices: approval, activation secret, heartbeat ─────────────────────────
ALTER TABLE "devices" ALTER COLUMN "code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "pairing_id" uuid;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "activation_secret_hash" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "activation_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "token_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "last_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "unsent_count" integer;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "storage_used_bytes" bigint;--> statement-breakpoint
UPDATE "devices" SET "status" = 'revoked' WHERE "revoked_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_status_check" CHECK ("status" IN ('pending_approval', 'active', 'rejected', 'revoked'));--> statement-breakpoint
-- The 3-digit code exists exactly when the device was approved; revoked_at exactly when revoked.
ALTER TABLE "devices" ADD CONSTRAINT "devices_code_status_check" CHECK (("code" IS NULL) = ("status" IN ('pending_approval', 'rejected')));--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_revoked_status_check" CHECK (("revoked_at" IS NOT NULL) = ("status" = 'revoked'));--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_counts_check" CHECK (coalesce("unsent_count", 0) >= 0 AND coalesce("storage_used_bytes", 0) >= 0);--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_approved_by_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_activation_secret_hash_unique" ON "devices" USING btree ("activation_secret_hash") WHERE "devices"."activation_secret_hash" is not null;--> statement-breakpoint

-- pending_approval → active or rejected; active → revoked; nothing else. A code, a token and a
-- revocation, once set, never change. Holds for every role, the owner's included.
CREATE FUNCTION devices_guard_transition() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'pending_approval' AND NEW.status IN ('active', 'rejected'))
    OR (OLD.status = 'active' AND NEW.status = 'revoked')) THEN
    RAISE EXCEPTION 'device % cannot go from % to %', OLD.id, OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.code IS NOT NULL AND NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'device % keeps its code', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.token_hash IS NOT NULL AND NEW.token_hash IS DISTINCT FROM OLD.token_hash THEN
    RAISE EXCEPTION 'device % keeps its token', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'device % stays revoked', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'device % stays in its branch', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER devices_guard_transition BEFORE UPDATE ON "devices" FOR EACH ROW EXECUTE FUNCTION devices_guard_transition();--> statement-breakpoint

-- Linking, approving, renaming and revoking are owner actions through the API; the device itself
-- updates only its contact and heartbeat columns. No DELETE: a device's code is never reused.
GRANT INSERT ON "devices" TO serva_app;--> statement-breakpoint
GRANT UPDATE ("name", "status", "code", "token_hash", "token_issued_at", "activation_secret_hash", "approved_by", "approved_at", "revoked_at", "last_heartbeat_at", "unsent_count", "storage_used_bytes") ON "devices" TO serva_app;--> statement-breakpoint

-- A device polling for its approval carries only its activation secret.
CREATE FUNCTION device_find_by_activation_hash(p_hash text)
RETURNS TABLE (id uuid, tenant_id uuid, tenant_status tenant_status)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.id, d.tenant_id, t.status
  FROM devices d
  JOIN tenants t ON t.id = d.tenant_id
  WHERE d.activation_secret_hash = p_hash
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION device_find_by_activation_hash(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION device_find_by_activation_hash(text) TO serva_app;--> statement-breakpoint

-- ─── device_pairings ─────────────────────────────────────────────────────────
CREATE TABLE "device_pairings" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"qr_token_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"device_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_pairings_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "device_pairings_hash_check" CHECK ("qr_token_hash" ~ '^[0-9a-f]{64}$' AND "code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "device_pairings_attempts_check" CHECK ("attempts" >= 0)
);--> statement-breakpoint
ALTER TABLE "device_pairings" ADD CONSTRAINT "device_pairings_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pairings" ADD CONSTRAINT "device_pairings_tenant_id_created_by_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pairings" ADD CONSTRAINT "device_pairings_tenant_id_device_id_devices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_pairings_qr_token_hash_unique" ON "device_pairings" USING btree ("qr_token_hash");--> statement-breakpoint
CREATE INDEX "device_pairings_code_idx" ON "device_pairings" USING btree ("tenant_id","code_hash");--> statement-breakpoint
ALTER TABLE "device_pairings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "device_pairings" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "device_pairings" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
GRANT SELECT, INSERT ON "device_pairings" TO serva_app;--> statement-breakpoint
GRANT UPDATE ("attempts", "used_at", "device_id") ON "device_pairings" TO serva_app;--> statement-breakpoint

-- A scanned QR carries only its token. Returns that pairing and its store's state, nothing else.
CREATE FUNCTION device_pairing_find_by_qr_hash(p_hash text)
RETURNS TABLE (id uuid, tenant_id uuid, tenant_status tenant_status)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.tenant_id, t.status
  FROM device_pairings p
  JOIN tenants t ON t.id = p.tenant_id
  WHERE p.qr_token_hash = p_hash
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION device_pairing_find_by_qr_hash(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION device_pairing_find_by_qr_hash(text) TO serva_app;--> statement-breakpoint

-- ─── permissions of the existing stores ──────────────────────────────────────
-- New stores get them from DEFAULT_ROLES; the owner links and revokes, the manager sees the list.
UPDATE "roles" SET "permissions" = array_append("permissions", 'devices.view')
WHERE "is_system" AND "key" IN ('owner', 'manager') AND NOT ('devices.view' = ANY ("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'devices.manage')
WHERE "is_system" AND "key" = 'owner' AND NOT ('devices.manage' = ANY ("permissions"));
