-- Round 64 (purchases): corrections of a supplier invoice due date, a log beside the append-only purchases (the latest row of an invoice is its due date).
CREATE TABLE "purchase_due_changes" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"due_date" date,
	"previous_due_date" date,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_due_changes_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "purchase_due_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_due_changes" ADD CONSTRAINT "purchase_due_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_due_changes" ADD CONSTRAINT "purchase_due_changes_tenant_id_purchase_id_purchases_tenant_id_id_fk" FOREIGN KEY ("tenant_id","purchase_id") REFERENCES "public"."purchases"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_due_changes_purchase_idx" ON "purchase_due_changes" USING btree ("tenant_id","purchase_id","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchase_due_changes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT ON "purchase_due_changes" TO serva_app;
