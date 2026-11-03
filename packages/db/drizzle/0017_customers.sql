-- Customers and their payments (09 › customers، receipts; 08 › سند قبض): customers are pulled by
-- every till and may be added by one; a receipt (RCV) is stored once from its document, and its
-- journal entry has the source type 'receipt'. The new permissions reach the stores' system roles.
CREATE TABLE "customers" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"tax_number" text,
	"address" text,
	"notes" text,
	"credit_limit_minor" bigint,
	"created_by_doc" uuid,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "customers_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"number" text NOT NULL,
	"business_date" date NOT NULL,
	"device_time" timestamp with time zone NOT NULL,
	"customer_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"shift_linked" boolean DEFAULT false NOT NULL,
	"cashier_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"payload" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_device_id_devices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "customers_change_xid_idx" ON "customers" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE INDEX "receipts_customer_idx" ON "receipts" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "receipts_shift_idx" ON "receipts" USING btree ("tenant_id","shift_id");--> statement-breakpoint
CREATE INDEX "receipts_business_date_idx" ON "receipts" USING btree ("tenant_id","branch_id","business_date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customers" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "receipts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "customers" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "receipts" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER sync_change_xid BEFORE INSERT OR UPDATE ON "customers" FOR EACH ROW EXECUTE FUNCTION sync_touch_change_xid();--> statement-breakpoint
CREATE TRIGGER sync_tombstone AFTER DELETE ON "customers" FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone('customers', 'id');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "customers" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "receipts" TO serva_app;--> statement-breakpoint
GRANT UPDATE ("shift_linked") ON "receipts" TO serva_app;--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_check";--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_check" CHECK ("source_type" IN ('sale', 'return', 'receipt', 'shift_close', 'cash_movement', 'manual', 'reversal'));--> statement-breakpoint
-- Credit sales, payments and customers: the owner and the branch manager get all four, the
-- cashier takes payments.
UPDATE "roles" SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p) FROM unnest("permissions" || ARRAY['sale.credit', 'receipt.create', 'customers.view', 'customers.manage']) AS p)
WHERE "key" IN ('owner', 'manager') AND "is_system";--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'receipt.create')
WHERE "key" = 'cashier' AND "is_system" AND NOT ('receipt.create' = ANY ("permissions"));
