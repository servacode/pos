CREATE TABLE "shortage_requests" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"variant_id" uuid,
	"name" text NOT NULL,
	"qty" bigint DEFAULT 1000 NOT NULL,
	"note" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	CONSTRAINT "shortage_requests_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "shortage_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "strength" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "dosage_form" text;--> statement-breakpoint
ALTER TABLE "shortage_requests" ADD CONSTRAINT "shortage_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shortage_requests_open_idx" ON "shortage_requests" USING btree ("tenant_id","resolved_at","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shortage_requests" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
-- Round 38: a shortage request is written by a till, closed by the manager (or by a purchase), never deleted.
GRANT SELECT, INSERT, UPDATE ON "shortage_requests" TO serva_app;
