-- Sale returns (08 › مرتجع مبيعات): the return and its lines, stored once by the RET processor.
-- A return names its sale without a foreign key, since it may arrive first; its journal entry has
-- the source type 'return'.
CREATE TABLE "sale_return_lines" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"sale_line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"qty" bigint NOT NULL,
	"base_qty" bigint NOT NULL,
	"tax_rate_id" uuid,
	"gross_ex_tax_minor" bigint NOT NULL,
	"discount_ex_tax_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_return_lines_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "sale_return_lines_line_unique" UNIQUE("tenant_id","return_id","line_no")
);
--> statement-breakpoint
ALTER TABLE "sale_return_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sale_returns" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"number" text NOT NULL,
	"business_date" date NOT NULL,
	"device_time" timestamp with time zone NOT NULL,
	"sale_id" uuid NOT NULL,
	"sale_number" text NOT NULL,
	"shift_id" uuid NOT NULL,
	"shift_linked" boolean DEFAULT false NOT NULL,
	"cashier_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"gross_ex_tax_minor" bigint NOT NULL,
	"discount_ex_tax_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"refund_method" text,
	"refund_reference" text,
	"approval" jsonb,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"payload" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_returns_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "sale_returns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_tenant_id_return_id_sale_returns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","return_id") REFERENCES "public"."sale_returns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_tenant_id_device_id_devices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_returns_sale_idx" ON "sale_returns" USING btree ("tenant_id","sale_id");--> statement-breakpoint
CREATE INDEX "sale_returns_shift_idx" ON "sale_returns" USING btree ("tenant_id","shift_id");--> statement-breakpoint
CREATE INDEX "sale_returns_business_date_idx" ON "sale_returns" USING btree ("tenant_id","branch_id","business_date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sale_return_lines" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sale_returns" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "sale_returns" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
-- The lines of a return never change once stored.
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "sale_return_lines" FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
GRANT SELECT, INSERT ON "sale_returns", "sale_return_lines" TO serva_app;--> statement-breakpoint
GRANT UPDATE ("shift_linked") ON "sale_returns" TO serva_app;--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_check";--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_check" CHECK ("source_type" IN ('sale', 'return', 'shift_close', 'cash_movement', 'manual', 'reversal'));
