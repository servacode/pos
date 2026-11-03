-- Transfers between branches (09 › transfers): goods out of one branch at its average cost and into
-- another at that value, each side with its stock movements and its entry against 1900.
CREATE TABLE "transfers" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"in_id" uuid NOT NULL,
	"number" text NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"note" text,
	"lines" jsonb NOT NULL,
	"value_minor" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_tenant_id_from_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","from_branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_tenant_id_to_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","to_branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "transfers" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_branches_check" CHECK (from_branch_id <> to_branch_id);--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_check";--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_check" CHECK ("source_type" IN ('sale', 'return', 'receipt', 'gift_voucher', 'purchase', 'supplier_payment', 'cost_of_sales', 'stocktake', 'transfer', 'cheque', 'shift_close', 'cash_movement', 'manual', 'reversal'));--> statement-breakpoint
GRANT SELECT, INSERT ON "transfers" TO serva_app;
