-- audit_logs: the fields of 09 (actor type, grant, field-by-field changes, reason, device and its
-- clock) and monthly partitions from day one, so old months are dropped as whole partitions
-- instead of deleted row by row. Drizzle cannot express partitioning; the table is rebuilt here.

ALTER TABLE "audit_logs" RENAME TO "audit_logs_unpartitioned";--> statement-breakpoint
ALTER TABLE "audit_logs_unpartitioned" RENAME CONSTRAINT "audit_logs_pkey" TO "audit_logs_unpartitioned_pkey";--> statement-breakpoint
ALTER INDEX "audit_logs_tenant_created_idx" RENAME TO "audit_logs_unpartitioned_tenant_created_idx";--> statement-breakpoint
ALTER TABLE "audit_logs_unpartitioned" DROP CONSTRAINT "audit_logs_tenant_id_tenants_id_fk";--> statement-breakpoint

CREATE TABLE "audit_logs" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"grant_id" uuid,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"changes" jsonb,
	"data" jsonb,
	"reason" text,
	"device_id" uuid,
	"device_time" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_pkey" PRIMARY KEY("tenant_id","id","created_at"),
	CONSTRAINT "audit_logs_actor_type_check" CHECK ("actor_type" IN ('user', 'accountant', 'platform_support', 'device', 'system'))
) PARTITION BY RANGE ("created_at");--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_created_idx" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint

-- Rows outside every monthly partition (e.g. a late-arriving device time) land here.
CREATE TABLE "audit_logs_default" PARTITION OF "audit_logs" DEFAULT;--> statement-breakpoint

-- Creates the monthly partitions from the current month up to p_months ahead (idempotent). Run
-- by the migration now and by a scheduled job later. Owner only: the API never creates tables.
CREATE FUNCTION audit_logs_add_partitions(p_months integer) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  m date := date_trunc('month', now())::date;
  v_last date := (date_trunc('month', now()) + make_interval(months => p_months))::date;
BEGIN
  WHILE m <= v_last LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
      'audit_logs_' || to_char(m, 'YYYY_MM'), m, (m + interval '1 month')::date);
    m := (m + interval '1 month')::date;
  END LOOP;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_logs_add_partitions(integer) FROM PUBLIC;--> statement-breakpoint
SELECT audit_logs_add_partitions(12);--> statement-breakpoint

INSERT INTO "audit_logs" ("id", "tenant_id", "user_id", "action", "entity", "entity_id", "data", "ip", "user_agent", "created_at")
SELECT "id", "tenant_id", "user_id", "action", "entity", "entity_id", "data", "ip", "user_agent", "created_at"
FROM "audit_logs_unpartitioned";--> statement-breakpoint
DROP TABLE "audit_logs_unpartitioned";--> statement-breakpoint

-- Same protection as before: RLS per store, insert and read only for the store role, and no
-- change or deletion by anyone (the row trigger reaches every partition). Partitions themselves
-- get no grant, so they can only be reached through the parent and its policy.
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_logs" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT ON "audit_logs" TO serva_app;--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION refuse_change();
