CREATE TABLE "contract_prices" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid,
	"customer_kind" text,
	"variant_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_prices_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "contract_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "maintenance_contracts" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid,
	"customer_name" text NOT NULL,
	"customer_phone" text,
	"devices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"visit_every_months" integer NOT NULL,
	"currency" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"visits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"billed_on" date,
	"cancelled" boolean DEFAULT false NOT NULL,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_contracts_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "maintenance_contracts_seq_unique" UNIQUE("tenant_id","seq")
);
--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rentals" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid,
	"status" text DEFAULT 'out' NOT NULL,
	"serial" text NOT NULL,
	"variant_id" uuid NOT NULL,
	"item" text NOT NULL,
	"customer_id" uuid,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"start_date" date NOT NULL,
	"expected_return" date NOT NULL,
	"rate_unit" text NOT NULL,
	"rate_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"deposit_minor" bigint DEFAULT 0 NOT NULL,
	"deposit_voucher" text,
	"note" text,
	"returned_on" date,
	"charge_minor" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rentals_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "rentals_seq_unique" UNIQUE("tenant_id","seq")
);
--> statement-breakpoint
ALTER TABLE "rentals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "rentable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_prices" ADD CONSTRAINT "contract_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_prices_customer_idx" ON "contract_prices" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "contract_prices_kind_idx" ON "contract_prices" USING btree ("tenant_id","customer_kind");--> statement-breakpoint
CREATE INDEX "contract_prices_variant_idx" ON "contract_prices" USING btree ("tenant_id","variant_id");--> statement-breakpoint
CREATE INDEX "maintenance_contracts_end_idx" ON "maintenance_contracts" USING btree ("tenant_id","end_date");--> statement-breakpoint
CREATE INDEX "rentals_status_idx" ON "rentals" USING btree ("tenant_id","status","expected_return");--> statement-breakpoint
CREATE INDEX "rentals_serial_idx" ON "rentals" USING btree ("tenant_id","serial");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contract_prices" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "maintenance_contracts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rentals" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_amounts_check" CHECK (rate_minor >= 0 AND deposit_minor >= 0 AND rate_unit IN ('day', 'week', 'month') AND status IN ('out', 'returned'));--> statement-breakpoint
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_check" CHECK (price_minor >= 0 AND visit_every_months > 0 AND end_date >= start_date);--> statement-breakpoint
ALTER TABLE "contract_prices" ADD CONSTRAINT "contract_prices_check" CHECK (price_minor >= 0 AND (customer_id IS NOT NULL OR customer_kind IS NOT NULL) AND (valid_to IS NULL OR valid_to >= valid_from));--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "rentals" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "maintenance_contracts" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "contract_prices" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "rentals", "maintenance_contracts", "contract_prices" TO serva_app;
--> statement-breakpoint
ALTER TABLE "serials" DROP CONSTRAINT "serials_status_check";--> statement-breakpoint
ALTER TABLE "serials" ADD CONSTRAINT "serials_status_check" CHECK ("status" IN ('in_stock', 'sold', 'rented'));
