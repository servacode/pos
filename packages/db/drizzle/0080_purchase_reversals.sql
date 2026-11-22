CREATE TABLE "purchase_reversals" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"purchase_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"reason" text,
	"lines" jsonb NOT NULL,
	"total_minor" bigint NOT NULL,
	"value_out_minor" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_reversals_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "purchase_reversals_purchase_unique" UNIQUE("tenant_id","purchase_id"),
	CONSTRAINT "purchase_reversals_number_unique" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
ALTER TABLE "purchase_reversals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_reversals" ADD CONSTRAINT "purchase_reversals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_reversals" ADD CONSTRAINT "purchase_reversals_tenant_id_purchase_id_purchases_tenant_id_id_fk" FOREIGN KEY ("tenant_id","purchase_id") REFERENCES "public"."purchases"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_reversals" ADD CONSTRAINT "purchase_reversals_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_reversals" ADD CONSTRAINT "purchase_reversals_tenant_id_supplier_id_suppliers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchase_reversals" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
-- Round 36, decision 12 (correct a posted purchase): the reversal document. Written once, never changed.
GRANT SELECT, INSERT ON "purchase_reversals" TO serva_app;
