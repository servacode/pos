CREATE TABLE "quotations" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"seq" integer NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid,
	"customer_name" text,
	"customer_phone" text,
	"customer_tax_number" text,
	"customer_address" text,
	"currency" text NOT NULL,
	"tax_inclusive" boolean NOT NULL,
	"issue_date" date NOT NULL,
	"valid_until" date NOT NULL,
	"notes" text,
	"terms" text,
	"lines" jsonb NOT NULL,
	"invoice_discount" jsonb,
	"totals" jsonb NOT NULL,
	"total_minor" bigint NOT NULL,
	"converted_at" timestamp with time zone,
	"created_by" uuid,
	"created_by_name" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "quotations_seq_unique" UNIQUE("tenant_id","year","seq"),
	CONSTRAINT "quotations_number_unique" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
ALTER TABLE "quotations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotations_status_idx" ON "quotations" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "quotations_customer_idx" ON "quotations" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "quotations" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_status_check" CHECK (status IN ('draft', 'sent', 'accepted', 'expired', 'converted'));--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_dates_check" CHECK (valid_until >= issue_date);--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "quotations" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "quotations" TO serva_app;
