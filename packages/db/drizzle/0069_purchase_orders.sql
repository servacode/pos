-- «طلبيات الشراء»: an order to a supplier is a promise, not a posting. Additive: one new table (row-level security by store,
-- grants for serva_app), nothing existing is touched.
CREATE TABLE "purchase_orders" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"supplier_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"expected_date" date,
	"notes" text,
	"lines" jsonb NOT NULL,
	"receipts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_minor" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "purchase_orders_number_unique" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_supplier_id_suppliers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchase_orders" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status_check" CHECK (status IN ('draft', 'sent', 'partial', 'received', 'cancelled'));--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "purchase_orders" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "purchase_orders" TO serva_app;
