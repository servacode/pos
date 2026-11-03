-- The wholesale mode (03 › الجملة ومواد البناء): a wholesale price per item and a price tier per
-- customer, cheques as a way to pay (1160 «شيكات تحت التحصيل» until cashed or bounced), and the
-- permission to sell at the wholesale price.
CREATE TABLE "cheque_actions" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"payment_no" integer NOT NULL,
	"action" text NOT NULL,
	"action_date" date NOT NULL,
	"note" text,
	"entry_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cheque_actions_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "cheque_actions_payment_unique" UNIQUE("tenant_id","source_type","source_id","payment_no")
);
--> statement-breakpoint
ALTER TABLE "cheque_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "price_tier" text DEFAULT 'retail' NOT NULL;--> statement-breakpoint
ALTER TABLE "prices" ADD COLUMN "wholesale_price_minor" bigint;--> statement-breakpoint
ALTER TABLE "cheque_actions" ADD CONSTRAINT "cheque_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cheque_actions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_price_tier_check" CHECK ("price_tier" IN ('retail', 'wholesale'));--> statement-breakpoint
ALTER TABLE "cheque_actions" ADD CONSTRAINT "cheque_actions_source_check" CHECK ("source_type" IN ('sale', 'receipt'));--> statement-breakpoint
ALTER TABLE "cheque_actions" ADD CONSTRAINT "cheque_actions_action_check" CHECK ("action" IN ('cleared', 'bounced'));--> statement-breakpoint
GRANT SELECT, INSERT ON "cheque_actions" TO serva_app;--> statement-breakpoint
GRANT UPDATE ("entry_id") ON "cheque_actions" TO serva_app;--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_check";--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_check" CHECK ("source_type" IN ('sale', 'return', 'receipt', 'purchase', 'supplier_payment', 'cost_of_sales', 'stocktake', 'cheque', 'shift_close', 'cash_movement', 'manual', 'reversal'));--> statement-breakpoint
-- Selling at the wholesale price: the owner and the branch manager.
UPDATE "roles" SET "permissions" = array_append("permissions", 'sale.wholesale')
WHERE "key" IN ('owner', 'manager') AND "is_system" AND NOT ('sale.wholesale' = ANY ("permissions"));
