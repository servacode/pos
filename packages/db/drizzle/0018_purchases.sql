-- Purchases and stock value (08 › فاتورة شراء، سند دفع، الجرد; 10 › الكلفة والربح): suppliers,
-- purchases and their lines, payments to suppliers, what each variant's stock is worth per branch,
-- the cost each sold line went at, and counts. Entered on the dashboard only. Posted documents
-- never change; supplier lines in the journal name the supplier.
CREATE TABLE "document_sequences" (
	"tenant_id" uuid NOT NULL,
	"series" text NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "document_sequences_pkey" PRIMARY KEY("tenant_id","series","year")
);
--> statement-breakpoint
ALTER TABLE "document_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "movement_costs" (
	"tenant_id" uuid NOT NULL,
	"doc_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"branch_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"kind" text NOT NULL,
	"cost_minor" bigint NOT NULL,
	"entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movement_costs_pkey" PRIMARY KEY("tenant_id","doc_id","line_no")
);
--> statement-breakpoint
ALTER TABLE "movement_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "purchase_lines" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"qty" bigint NOT NULL,
	"cost_minor" bigint NOT NULL,
	CONSTRAINT "purchase_lines_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "purchase_lines_line_unique" UNIQUE("tenant_id","purchase_id","line_no")
);
--> statement-breakpoint
ALTER TABLE "purchase_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"payment" text NOT NULL,
	"reference" text,
	"notes" text,
	"total_minor" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "purchases_number_unique" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
ALTER TABLE "purchases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_values" (
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" bigint DEFAULT 0 NOT NULL,
	"value_minor" bigint DEFAULT 0 NOT NULL,
	"ref_qty" bigint DEFAULT 0 NOT NULL,
	"ref_value_minor" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_values_pkey" PRIMARY KEY("tenant_id","branch_id","variant_id")
);
--> statement-breakpoint
ALTER TABLE "stock_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stocktakes" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"note" text,
	"lines" jsonb NOT NULL,
	"diff_value_minor" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stocktakes_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "stocktakes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"method" text NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_payments_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "supplier_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_costs" ADD CONSTRAINT "movement_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_tenant_id_purchase_id_purchases_tenant_id_id_fk" FOREIGN KEY ("tenant_id","purchase_id") REFERENCES "public"."purchases"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_tenant_id_supplier_id_suppliers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_values" ADD CONSTRAINT "stock_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_tenant_id_supplier_id_suppliers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchases_date_idx" ON "purchases" USING btree ("tenant_id","business_date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_sequences" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "movement_costs" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchase_lines" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchases" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_values" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stocktakes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "supplier_payments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "suppliers" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "suppliers" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "stock_values" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "purchases" FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "purchase_lines" FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "supplier_payments" FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "stocktakes" FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "movement_costs" FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "suppliers", "stock_values", "document_sequences" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "purchases", "purchase_lines", "supplier_payments", "stocktakes", "movement_costs" TO serva_app;--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_check";--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_check" CHECK ("source_type" IN ('sale', 'return', 'receipt', 'purchase', 'supplier_payment', 'cost_of_sales', 'stocktake', 'shift_close', 'cash_movement', 'manual', 'reversal'));--> statement-breakpoint
ALTER TABLE "journal_lines" DROP CONSTRAINT "journal_lines_party_check";--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_party_check" CHECK (("party_type" IS NULL) = ("party_id" IS NULL) AND coalesce("party_type", 'user') IN ('customer', 'supplier', 'user'));
