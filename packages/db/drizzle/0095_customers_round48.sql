-- Round 48 (customers): the customer list is paged and searched in SQL, so invoices need an index by customer;
-- customer groups with a discount, a customer's birthday, and a voucher's expiry and void.
CREATE INDEX IF NOT EXISTS "invoices_customer_idx" ON "invoices" USING btree ("tenant_id","customer_id","business_date");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_groups" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_groups_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "customer_groups_discount_check" CHECK ("discount_bps" >= 0 AND "discount_bps" <= 10000)
);
--> statement-breakpoint
ALTER TABLE "customer_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_groups" ADD CONSTRAINT "customer_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_groups_name_unique" ON "customer_groups" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_groups" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "customer_groups" TO serva_app;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_group_fk" FOREIGN KEY ("tenant_id","group_id") REFERENCES "customer_groups"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "expires_on" date;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "void_reason" text;
