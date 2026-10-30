-- Sync contract v1 (15 › عقد المزامنة v1 للمهندسين; 09 › التدقيق والمزامنة):
--   * devices replaces registers (09: «الجهاز أعم من الصندوق»), with the minimum sync needs;
--   * change_xid (xid8) on every table devices pull, kept by a trigger, and sync_tombstones for
--     deletions, also written by a trigger;
--   * sync_inbox, the durable raw inbox, unique per store by document id with no expiry;
--   * doc_sequences (what each device announced and what arrived), number_gaps (declared losses);
--   * server_state with server_epoch, bumped after a restore from backup.
-- sync_inbox and sync_tombstones are partitioned by month from day one (09 › التقسيم بالشهر).
-- Drizzle cannot express partitioning, so they are written by hand here like audit_logs (0008).

-- ─── branch codes ────────────────────────────────────────────────────────────
-- Document numbers carry the branch in 3 digits (09 › branches: «الرمز (3 خانات: 001)»; 08);
-- sign-up created the main branch as '01'.
UPDATE "branches" SET "code" = lpad("code", 3, '0') WHERE "code" ~ '^[0-9]{1,2}$';--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_code_check" CHECK ("code" ~ '^[0-9]{3}$');--> statement-breakpoint

-- ─── registers → devices ─────────────────────────────────────────────────────
-- registers was never used by the API and holds no rows; it is dropped rather than renamed.
DROP TABLE "registers";--> statement-breakpoint

CREATE TABLE "devices" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'cashier' NOT NULL,
	"platform" text DEFAULT 'browser' NOT NULL,
	"token_hash" text,
	"public_key" text,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"app_version" text,
	"clock_offset_ms" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "devices_branch_code_unique" UNIQUE("tenant_id","branch_id","code"),
	-- 000 is the server's own code in document numbers (08 › الترقيم)
	CONSTRAINT "devices_code_check" CHECK ("code" ~ '^[0-9]{3}$' AND "code" <> '000'),
	CONSTRAINT "devices_kind_check" CHECK ("kind" IN ('cashier', 'android_pos', 'rep_phone', 'waiter', 'price_checker', 'kitchen_screen', 'call_screen', 'hub')),
	CONSTRAINT "devices_platform_check" CHECK ("platform" IN ('browser', 'windows', 'android', 'ios'))
);--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_hash_unique" ON "devices" USING btree ("token_hash") WHERE "devices"."token_hash" is not null;--> statement-breakpoint
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "devices" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "devices" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint

-- A device request carries only its token. This returns the one device with that hash (owned by
-- serva_owner, so RLS does not hide it) and its store's status, nothing else.
CREATE FUNCTION device_find_by_token_hash(p_hash text)
RETURNS TABLE (id uuid, tenant_id uuid, branch_id uuid, code text, revoked_at timestamptz, tenant_status tenant_status)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.id, d.tenant_id, d.branch_id, d.code, d.revoked_at, t.status
  FROM devices d
  JOIN tenants t ON t.id = d.tenant_id
  WHERE d.token_hash = p_hash
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION device_find_by_token_hash(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION device_find_by_token_hash(text) TO serva_app;--> statement-breakpoint

-- Devices are paired and revoked by the owner (17 › الأجهزة, not built yet). The device itself may
-- only record when it was last seen.
GRANT SELECT ON "devices" TO serva_app;--> statement-breakpoint
GRANT UPDATE ("last_seen_at", "last_sync_at", "app_version", "clock_offset_ms") ON "devices" TO serva_app;--> statement-breakpoint

-- ─── change_xid on pulled tables ─────────────────────────────────────────────
-- The pull stops at pg_snapshot_xmin(pg_current_snapshot()), so a transaction that commits late
-- is never skipped (15 › السحب).
CREATE FUNCTION sync_touch_change_xid() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.change_xid := pg_current_xact_id();
  RETURN NEW;
END $$;--> statement-breakpoint

-- A deleted row becomes a tombstone the devices pull. TG_ARGV: the pull set, the id column.
-- SECURITY DEFINER: the store role cannot write tombstones itself.
CREATE FUNCTION sync_record_tombstone() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO sync_tombstones (tenant_id, collection, record_id)
  VALUES (OLD.tenant_id, TG_ARGV[0], (to_jsonb(OLD) ->> TG_ARGV[1])::uuid);
  RETURN OLD;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION sync_record_tombstone() FROM PUBLIC;--> statement-breakpoint

ALTER TABLE "tenant_settings" ADD COLUMN "change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL;--> statement-breakpoint
CREATE INDEX "tenant_settings_change_xid_idx" ON "tenant_settings" USING btree ("tenant_id","change_xid");--> statement-breakpoint
CREATE INDEX "branches_change_xid_idx" ON "branches" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE INDEX "roles_change_xid_idx" ON "roles" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE INDEX "users_change_xid_idx" ON "users" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE INDEX "user_roles_change_xid_idx" ON "user_roles" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('tenant_settings', 'settings', 'tenant_id'),
    ('branches', 'branches', 'id'),
    ('roles', 'roles', 'id'),
    ('users', 'users', 'id'),
    ('user_roles', 'user_roles', 'id')
  ) AS v(tbl, collection, id_column)
  LOOP
    EXECUTE format('CREATE TRIGGER sync_change_xid BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION sync_touch_change_xid()', t.tbl);
    EXECUTE format('CREATE TRIGGER sync_tombstone AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone(%L, %L)', t.tbl, t.collection, t.id_column);
  END LOOP;
END $$;--> statement-breakpoint

-- ─── sync_tombstones (monthly partitions on created_at) ──────────────────────
CREATE TABLE "sync_tombstones" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"collection" text NOT NULL,
	"record_id" uuid NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_tombstones_pkey" PRIMARY KEY("tenant_id","id","created_at")
) PARTITION BY RANGE ("created_at");--> statement-breakpoint
ALTER TABLE "sync_tombstones" ADD CONSTRAINT "sync_tombstones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_tombstones_pull_idx" ON "sync_tombstones" USING btree ("tenant_id","collection","change_xid","record_id");--> statement-breakpoint
CREATE TABLE "sync_tombstones_default" PARTITION OF "sync_tombstones" DEFAULT;--> statement-breakpoint
ALTER TABLE "sync_tombstones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sync_tombstones" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT ON "sync_tombstones" TO serva_app;--> statement-breakpoint

-- ─── sync_inbox (monthly partitions on the document id's UUIDv7 time) ────────
-- Unique per store by document id, for ever: the partition key is the id itself, so the same id
-- always lands in the same partition and the primary key holds across all of them. Ids whose
-- time falls outside every partition (a device clock far off) land in the default partition.
CREATE TABLE "sync_inbox" (
	"tenant_id" uuid NOT NULL,
	"doc_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"device_seq" bigint NOT NULL,
	"doc_type" text NOT NULL,
	"number" text,
	"payload_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"deps" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"contract_version" integer NOT NULL,
	"engine_version" text NOT NULL,
	"app_version" text,
	"device_time" timestamp with time zone NOT NULL,
	"business_date" date NOT NULL,
	"status" text NOT NULL,
	"result_code" text,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "sync_inbox_pkey" PRIMARY KEY("tenant_id","doc_id"),
	CONSTRAINT "sync_inbox_status_check" CHECK ("status" IN ('accepted', 'pending_link', 'rejected', 'quarantined')),
	CONSTRAINT "sync_inbox_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$')
) PARTITION BY RANGE ("doc_id");--> statement-breakpoint
ALTER TABLE "sync_inbox" ADD CONSTRAINT "sync_inbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_inbox" ADD CONSTRAINT "sync_inbox_tenant_id_device_id_devices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_inbox_number_idx" ON "sync_inbox" USING btree ("tenant_id","doc_type","number");--> statement-breakpoint
CREATE INDEX "sync_inbox_device_seq_idx" ON "sync_inbox" USING btree ("tenant_id","device_id","device_seq");--> statement-breakpoint
-- Documents waiting for one of their dependencies, found when that dependency arrives.
CREATE INDEX "sync_inbox_pending_deps_idx" ON "sync_inbox" USING gin ("deps") WHERE "status" = 'pending_link';--> statement-breakpoint
CREATE TABLE "sync_inbox_default" PARTITION OF "sync_inbox" DEFAULT;--> statement-breakpoint
ALTER TABLE "sync_inbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sync_inbox" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
-- Insert-once: the document as it arrived never changes; only its processing state does.
GRANT SELECT, INSERT ON "sync_inbox" TO serva_app;--> statement-breakpoint
GRANT UPDATE ("status", "result_code", "flags", "processed_at") ON "sync_inbox" TO serva_app;--> statement-breakpoint

-- The smallest UUIDv7 of a moment: a partition bound on document ids.
CREATE FUNCTION uuid_v7_floor(p_at timestamptz) RETURNS uuid
LANGUAGE sql IMMUTABLE
AS $$
  SELECT (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-0000-0000-000000000000')::uuid
  FROM lpad(to_hex(floor(extract(epoch FROM p_at) * 1000)::bigint), 12, '0') AS h
$$;--> statement-breakpoint

-- Creates the monthly partitions of both sync tables (UTC months) from p_back months ago to
-- p_ahead months ahead; idempotent. Run by this migration and by a scheduled job later. Owner
-- only: the API never creates tables.
CREATE FUNCTION sync_add_partitions(p_back integer, p_ahead integer) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  m timestamp := date_trunc('month', now() AT TIME ZONE 'UTC') - make_interval(months => p_back);
  v_last timestamp := date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => p_ahead);
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  WHILE m <= v_last LOOP
    v_from := m AT TIME ZONE 'UTC';
    v_to := (m + interval '1 month') AT TIME ZONE 'UTC';
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF sync_inbox FOR VALUES FROM (%L) TO (%L)',
      'sync_inbox_' || to_char(m, 'YYYY_MM'), uuid_v7_floor(v_from), uuid_v7_floor(v_to));
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF sync_tombstones FOR VALUES FROM (%L) TO (%L)',
      'sync_tombstones_' || to_char(m, 'YYYY_MM'), v_from, v_to);
    m := m + interval '1 month';
  END LOOP;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION sync_add_partitions(integer, integer) FROM PUBLIC;--> statement-breakpoint
-- Two months back: documents made offline (up to 14 days) or resent after a restore (30 days).
SELECT sync_add_partitions(2, 12);--> statement-breakpoint

-- ─── doc_sequences and number_gaps ───────────────────────────────────────────
CREATE TABLE "doc_sequences" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"series" text NOT NULL,
	"last_announced" integer DEFAULT 0 NOT NULL,
	"last_received" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_sequences_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "doc_sequences_device_series_unique" UNIQUE("tenant_id","device_id","series")
);--> statement-breakpoint
ALTER TABLE "doc_sequences" ADD CONSTRAINT "doc_sequences_tenant_id_device_id_devices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "doc_sequences" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "doc_sequences" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
GRANT SELECT, INSERT ON "doc_sequences" TO serva_app;--> statement-breakpoint
GRANT UPDATE ("last_announced", "last_received") ON "doc_sequences" TO serva_app;--> statement-breakpoint

CREATE TABLE "number_gaps" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"series" text NOT NULL,
	"from_seq" integer NOT NULL,
	"to_seq" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "number_gaps_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "number_gaps_range_check" CHECK ("from_seq" >= 1 AND "from_seq" <= "to_seq"),
	CONSTRAINT "number_gaps_reason_check" CHECK (length(btrim("reason")) > 0)
);--> statement-breakpoint
ALTER TABLE "number_gaps" ADD CONSTRAINT "number_gaps_tenant_id_device_id_devices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_gaps" ADD CONSTRAINT "number_gaps_tenant_id_created_by_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_gaps" ADD CONSTRAINT "number_gaps_tenant_id_approved_by_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_gaps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "number_gaps" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "number_gaps" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
-- Declared and approved by the owner's screens (not built yet); read-only for now.
GRANT SELECT ON "number_gaps" TO serva_app;--> statement-breakpoint

-- ─── server_state and the epoch ──────────────────────────────────────────────
CREATE TABLE "server_state" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"server_epoch" integer DEFAULT 1 NOT NULL,
	"epoch_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tombstone_horizon" "xid8" DEFAULT '0'::xid8 NOT NULL,
	CONSTRAINT "server_state_single_row" CHECK ("id")
);--> statement-breakpoint
INSERT INTO "server_state" DEFAULT VALUES;--> statement-breakpoint
GRANT SELECT ON "server_state" TO serva_app;--> statement-breakpoint

-- Run once right after restoring the database from a backup, before the API serves devices:
-- every device then sees a new epoch, resends its last 30 days (duplicates are ignored) and
-- downloads everything again. Server-numbered series (none yet) must jump 1,000 here too.
CREATE FUNCTION server_epoch_bump() RETURNS integer
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  UPDATE server_state SET server_epoch = server_epoch + 1, epoch_changed_at = now() RETURNING server_epoch
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION server_epoch_bump() FROM PUBLIC;
