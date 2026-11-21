CREATE TABLE "expenses" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"account_code" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"base_amount_minor" bigint NOT NULL,
	"rate" jsonb,
	"pay_from" text NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "expenses_number_unique" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("tenant_id","business_date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "expenses" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
-- Expenses (29 › المصاريف): a document with one automatic entry (source 'expense'), never changed.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_check" CHECK (amount_minor > 0 AND base_amount_minor > 0 AND account_code ~ '^6[0-9]{3,5}$' AND currency IN ('SYP', 'USD') AND pay_from IN ('safe', 'bank', 'wallet', 'card'));--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "expenses" FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
GRANT SELECT, INSERT ON "expenses" TO serva_app;--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_check";--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_check" CHECK ("source_type" IN ('sale', 'return', 'receipt', 'gift_voucher', 'purchase', 'supplier_payment', 'supplier_return', 'cost_of_sales', 'stocktake', 'transfer', 'cheque', 'expense', 'shift_close', 'cash_movement', 'manual', 'reversal'));--> statement-breakpoint
-- Two new keys: «تسجيل المصاريف» for the owner and every manager, «القيود اليدوية» for the owner alone.
UPDATE "roles" SET "permissions" = "permissions" || ARRAY['expenses.manage']
WHERE "is_system" AND "key" IN ('owner', 'manager') AND NOT ('expenses.manage' = ANY ("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY['accounting.post']
WHERE "is_system" AND "key" = 'owner' AND NOT ('accounting.post' = ANY ("permissions"));
