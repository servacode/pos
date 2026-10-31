-- The catalog and the sale documents (phase 1, step 2; docs/contracts/step4.md; 09 › الأصناف):
--   * units, tax_rates, categories, products, variants, prices (one row per variant), barcodes,
--     stock_levels and exchange_rates: pulled by devices, so each keeps change_xid and leaves
--     tombstones; products.search_name (normalizeArabic, written by the API) has a trigram index;
--   * stock_movements (append-only, one row per document line), and the documents the sync
--     processors store: shifts, invoices with their lines and payments, cash_movements;
--   * tenant_settings gains the business-day cutoff, the shift mode and the idle minutes; users gain pin_length and
--     pin_version; pin_attempts keeps the PIN lockout per user and device;
--   * every existing store gets the two system units; owners and managers get cost.view.

CREATE TABLE "barcodes" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" text DEFAULT 'standard' NOT NULL,
	"pack_qty" integer DEFAULT 1000 NOT NULL,
	"pack_name" text,
	"pack_price_minor" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "barcodes_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "barcodes_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
ALTER TABLE "barcodes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"number" text,
	"business_date" date NOT NULL,
	"shift_id" uuid NOT NULL,
	"shift_linked" boolean DEFAULT false NOT NULL,
	"kind" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"base_currency" text NOT NULL,
	"rate" jsonb,
	"base_amount_minor" bigint NOT NULL,
	"reason" text NOT NULL,
	"expense_account_code" text,
	"reference" text,
	"performed_by" uuid NOT NULL,
	"approval" jsonb,
	"payload" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_movements_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cash_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "categories_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"quote" text NOT NULL,
	"rate" text NOT NULL,
	"collect_rate" text,
	"min_rate" text,
	"max_rate" text,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "exchange_rates_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "exchange_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"barcode" text,
	"pack_qty" integer NOT NULL,
	"qty" bigint NOT NULL,
	"base_qty" bigint NOT NULL,
	"price_currency" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"tax_rate_id" uuid,
	"tax_rate_bp" integer NOT NULL,
	"gross_minor" bigint NOT NULL,
	"discount_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "invoice_lines_line_unique" UNIQUE("tenant_id","invoice_id","line_no")
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"payment_no" integer NOT NULL,
	"method" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"rate" jsonb,
	"base_amount_minor" bigint NOT NULL,
	"reference" text,
	"card_last4" text,
	"card_brand" text,
	"provider_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_payments_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "invoice_payments_no_unique" UNIQUE("tenant_id","invoice_id","payment_no")
);
--> statement-breakpoint
ALTER TABLE "invoice_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"number" text NOT NULL,
	"business_date" date NOT NULL,
	"device_time" timestamp with time zone NOT NULL,
	"shift_id" uuid NOT NULL,
	"shift_linked" boolean DEFAULT false NOT NULL,
	"cashier_id" uuid NOT NULL,
	"salesperson_id" uuid,
	"customer_id" uuid,
	"customer_name" text,
	"currency" text NOT NULL,
	"tax_inclusive" boolean NOT NULL,
	"gross_minor" bigint NOT NULL,
	"discount_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"tip_minor" bigint NOT NULL,
	"rounding_base_minor" bigint DEFAULT 0 NOT NULL,
	"change_base_minor" bigint DEFAULT 0 NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"payload" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pin_attempts" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pin_attempts_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "pin_attempts_user_device_unique" UNIQUE("tenant_id","user_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "pin_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prices" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"min_price_minor" bigint,
	"price_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "prices_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"search_name" text NOT NULL,
	"category_id" uuid,
	"brand" text,
	"type" text DEFAULT 'stock' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"unit_id" uuid NOT NULL,
	"tax_rate_id" uuid,
	"sell_on_pos" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "products_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"number" text,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_by" uuid,
	"mode" text,
	"handover_from_shift_id" uuid,
	"opening" jsonb,
	"opened_at" timestamp with time zone,
	"business_date" date,
	"close_doc_id" uuid,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"closing" jsonb,
	"shortage_treatment" text,
	"forced" boolean,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_levels" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" bigint DEFAULT 0 NOT NULL,
	"reserved_qty" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "stock_levels_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "stock_levels_branch_variant_unique" UNIQUE("tenant_id","branch_id","variant_id")
);
--> statement-breakpoint
ALTER TABLE "stock_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" bigint NOT NULL,
	"kind" text NOT NULL,
	"doc_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"business_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "stock_movements_doc_line_unique" UNIQUE("tenant_id","doc_id","line_no")
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rate_bp" integer NOT NULL,
	"kind" text NOT NULL,
	"show_on_receipt" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "tax_rates_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "tax_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"allows_fraction" boolean DEFAULT false NOT NULL,
	"system_key" text,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "units_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "units_system_key_unique" UNIQUE("tenant_id","system_key")
);
--> statement-breakpoint
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "variants" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text,
	"label" text,
	"attributes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"min_stock_qty" bigint,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "variants_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "business_day_cutoff" text DEFAULT '00:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "shift_mode" text DEFAULT 'per_cashier' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "idle_minutes" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pin_length" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pin_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "barcodes" ADD CONSTRAINT "barcodes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barcodes" ADD CONSTRAINT "barcodes_tenant_id_variant_id_variants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."variants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenant_id_device_id_devices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_parent_id_categories_tenant_id_id_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_tenant_id_created_by_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_invoice_id_invoices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_tenant_id_invoice_id_invoices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_device_id_devices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin_attempts" ADD CONSTRAINT "pin_attempts_tenant_id_user_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin_attempts" ADD CONSTRAINT "pin_attempts_tenant_id_device_id_devices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_tenant_id_id_variants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","id") REFERENCES "public"."variants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_category_id_categories_tenant_id_id_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_unit_id_units_tenant_id_id_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tax_rate_id_tax_rates_tenant_id_id_fk" FOREIGN KEY ("tenant_id","tax_rate_id") REFERENCES "public"."tax_rates"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_id_device_id_devices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_variant_id_variants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."variants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_tenant_id_product_id_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "barcodes_change_xid_idx" ON "barcodes" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE INDEX "barcodes_variant_idx" ON "barcodes" USING btree ("tenant_id","variant_id");--> statement-breakpoint
CREATE INDEX "cash_movements_shift_idx" ON "cash_movements" USING btree ("tenant_id","shift_id");--> statement-breakpoint
CREATE INDEX "categories_change_xid_idx" ON "categories" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE INDEX "exchange_rates_change_xid_idx" ON "exchange_rates" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE INDEX "invoice_lines_variant_idx" ON "invoice_lines" USING btree ("tenant_id","variant_id");--> statement-breakpoint
CREATE INDEX "invoices_shift_idx" ON "invoices" USING btree ("tenant_id","shift_id");--> statement-breakpoint
CREATE INDEX "invoices_business_date_idx" ON "invoices" USING btree ("tenant_id","branch_id","business_date");--> statement-breakpoint
CREATE INDEX "prices_change_xid_idx" ON "prices" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE INDEX "products_change_xid_idx" ON "products" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "stock_levels_change_xid_idx" ON "stock_levels" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE INDEX "stock_movements_variant_idx" ON "stock_movements" USING btree ("tenant_id","variant_id","created_at");--> statement-breakpoint
CREATE INDEX "tax_rates_change_xid_idx" ON "tax_rates" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE INDEX "units_change_xid_idx" ON "units" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE INDEX "variants_change_xid_idx" ON "variants" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE INDEX "variants_product_idx" ON "variants" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "barcodes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cash_movements" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "categories" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "exchange_rates" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoice_lines" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoice_payments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoices" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "pin_attempts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prices" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "products" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shifts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_levels" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_movements" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tax_rates" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "units" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "variants" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- ─── Checks ──────────────────────────────────────────────────────────────────
ALTER TABLE "units" ADD CONSTRAINT "units_text_check" CHECK (length(btrim("name")) BETWEEN 1 AND 20 AND length(btrim("symbol")) BETWEEN 1 AND 10);--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_system_key_check" CHECK ("system_key" IS NULL OR "system_key" IN ('piece', 'kg'));--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_rate_check" CHECK ("rate_bp" BETWEEN 0 AND 10000);--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_kind_check" CHECK ("kind" IN ('consumption', 'stamp', 'sales'));--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_check" CHECK ("parent_id" IS DISTINCT FROM "id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_type_check" CHECK ("type" IN ('stock', 'service'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_status_check" CHECK ("status" IN ('active', 'temporary'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_name_check" CHECK (length(btrim("name_ar")) > 0);--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_min_stock_check" CHECK (coalesce("min_stock_qty", 0) >= 0);--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_currency_check" CHECK ("currency" IN ('SYP', 'USD'));--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_amount_check" CHECK ("price_minor" >= 0 AND coalesce("min_price_minor", 0) >= 0);--> statement-breakpoint
-- Printable ASCII only, as scanners send (core › barcodeCodeSchema).
ALTER TABLE "barcodes" ADD CONSTRAINT "barcodes_code_check" CHECK ("code" ~ '^[!-~]{3,48}$');--> statement-breakpoint
ALTER TABLE "barcodes" ADD CONSTRAINT "barcodes_kind_check" CHECK ("kind" IN ('standard', 'internal'));--> statement-breakpoint
ALTER TABLE "barcodes" ADD CONSTRAINT "barcodes_pack_check" CHECK ("pack_qty" > 0 AND coalesce("pack_price_minor", 0) >= 0);--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_reserved_check" CHECK ("reserved_qty" >= 0);--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_pair_check" CHECK ("unit" <> "quote" AND "unit" IN ('SYP', 'USD') AND "quote" IN ('SYP', 'USD'));--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_rate_check" CHECK ("rate" ~ '^[0-9]+(\.[0-9]{1,6})?$');--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_cutoff_check" CHECK ("business_day_cutoff" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_shift_mode_check" CHECK ("shift_mode" IN ('per_cashier', 'shared', 'handover'));--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_idle_minutes_check" CHECK ("idle_minutes" BETWEEN 1 AND 240);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_pin_check" CHECK (("pin_hash" IS NULL) = ("pin_length" IS NULL) AND coalesce("pin_length", 4) IN (4, 6) AND "pin_version" >= 0);--> statement-breakpoint
ALTER TABLE "pin_attempts" ADD CONSTRAINT "pin_attempts_failures_check" CHECK ("failures" >= 0);--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_status_check" CHECK ("status" IN ('open', 'closed'));--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_kind_check" CHECK ("kind" IN ('pay_in', 'pay_out', 'expense', 'safe_drop'));--> statement-breakpoint

-- ─── Search (15 › البحث في الأصناف; contract Q7) ─────────────────────────────
-- search_name is normalizeArabic() of the names, written by the API; `q` matches any part of it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "products_search_name_trgm_idx" ON "products" USING gin ("search_name" gin_trgm_ops);--> statement-breakpoint

-- ─── Triggers: version, pull watermark, tombstones, append-only ──────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['units', 'tax_rates', 'categories', 'products', 'variants', 'prices', 'barcodes',
                           'stock_levels', 'exchange_rates', 'pin_attempts', 'shifts', 'invoices', 'cash_movements']
  LOOP
    EXECUTE format('CREATE TRIGGER bump_row_version BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION bump_row_version()', t);
  END LOOP;
END $$;--> statement-breakpoint

-- Every table a device pulls: change_xid by trigger, a tombstone on delete (the pull set's name).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('units', 'units'),
    ('tax_rates', 'tax_rates'),
    ('categories', 'categories'),
    ('products', 'products'),
    ('variants', 'variants'),
    ('prices', 'prices'),
    ('barcodes', 'barcodes'),
    ('stock_levels', 'stock_levels'),
    ('exchange_rates', 'exchange_rates')
  ) AS v(tbl, collection)
  LOOP
    EXECUTE format('CREATE TRIGGER sync_change_xid BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION sync_touch_change_xid()', t.tbl);
    EXECUTE format('CREATE TRIGGER sync_tombstone AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone(%L, %L)', t.tbl, t.collection, 'id');
  END LOOP;
END $$;--> statement-breakpoint

-- Stock moves only by new rows; the lines and payments of a sale never change once stored.
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "invoice_lines" FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "invoice_payments" FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint

-- The settings pull set shows the store's name, tax number and time zone from tenants: a change
-- there touches the settings row, so its version and change_xid move and devices pull it again.
CREATE FUNCTION tenant_settings_follow_tenant() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.name, NEW.tax_number, NEW.timezone) IS DISTINCT FROM (OLD.name, OLD.tax_number, OLD.timezone) THEN
    UPDATE tenant_settings SET updated_at = now() WHERE tenant_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER tenant_settings_follow_tenant AFTER UPDATE ON "tenants" FOR EACH ROW EXECUTE FUNCTION tenant_settings_follow_tenant();--> statement-breakpoint

-- ─── Grants ──────────────────────────────────────────────────────────────────
-- Catalog rows are archived, never deleted; a barcode removed from a variant is deleted (devices
-- get its tombstone). Documents are stored once; only their links and state change.
GRANT SELECT, INSERT, UPDATE ON "units", "tax_rates", "categories", "products", "variants", "prices", "stock_levels", "exchange_rates" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "barcodes" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "stock_movements", "invoice_lines", "invoice_payments" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "pin_attempts" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "shifts", "invoices", "cash_movements" TO serva_app;--> statement-breakpoint
GRANT UPDATE ("number", "status", "opened_by", "mode", "handover_from_shift_id", "opening", "opened_at", "business_date", "close_doc_id", "closed_by", "closed_at", "closing", "shortage_treatment", "forced") ON "shifts" TO serva_app;--> statement-breakpoint
GRANT UPDATE ("shift_linked") ON "invoices", "cash_movements" TO serva_app;--> statement-breakpoint

-- ─── Every store's units, and permissions of the existing stores ─────────────
-- New stores get «قطعة» and «كيلو» from the API at sign-up (services/catalog-defaults.ts) and no
-- tax rate (docs/contracts/step4.md decision 5).
INSERT INTO "units" ("tenant_id", "name", "symbol", "allows_fraction", "system_key")
SELECT t.id, 'قطعة', 'قطعة', false, 'piece' FROM "tenants" t
ON CONFLICT ON CONSTRAINT "units_system_key_unique" DO NOTHING;--> statement-breakpoint
INSERT INTO "units" ("tenant_id", "name", "symbol", "allows_fraction", "system_key")
SELECT t.id, 'كيلو', 'كغ', true, 'kg' FROM "tenants" t
ON CONFLICT ON CONSTRAINT "units_system_key_unique" DO NOTHING;--> statement-breakpoint
-- cost.view (09, 34: the owner and the manager) guards cost columns, none of which exist yet.
UPDATE "roles" SET "permissions" = array_append("permissions", 'cost.view')
WHERE "is_system" AND "key" IN ('owner', 'manager') AND NOT ('cost.view' = ANY ("permissions"));
