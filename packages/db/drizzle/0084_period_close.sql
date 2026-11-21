ALTER TABLE "journal_entries" ADD COLUMN "posted_to_open_period" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "period_locks" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"locked_through" date,
	"previous_through" date,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_locks_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "period_locks_kind_check" CHECK ("kind" IN ('close', 'reopen'))
);
--> statement-breakpoint
ALTER TABLE "period_locks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "period_locks_latest_idx" ON "period_locks" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "period_locks" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
-- Round 37, decision 17 (period close): every close and reopen, written once, never changed.
GRANT SELECT, INSERT ON "period_locks" TO serva_app;

--> statement-breakpoint
-- The two new permissions belong to the owner (DEFAULT_ROLES gives them to the owner of a new store; every
-- store's existing owner role gets them here, without repeating one it already has).
UPDATE "roles"
SET "permissions" = "permissions" || ARRAY(
      SELECT p FROM unnest(ARRAY['period.lock', 'period.unlock']) AS p WHERE NOT (p = ANY ("permissions"))
    )
WHERE "key" = 'owner' AND "is_system";
