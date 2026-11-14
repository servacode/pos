-- Warranty and maintenance claims (03 › الإلكترونيات والأدوات الطبية): a serial-tracked piece handed back for a
-- fault, followed from received to delivered. Nothing posts and no stock moves.
CREATE TABLE "warranty_claims" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"serial" text NOT NULL,
	"variant_id" uuid,
	"item" text NOT NULL,
	"sale_id" uuid,
	"sale_number" text,
	"sold_on" date,
	"warranty_until" date,
	"under_warranty" boolean DEFAULT false NOT NULL,
	"customer_name" text,
	"customer_phone" text,
	"issue" text NOT NULL,
	"sent_to" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warranty_claims_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "warranty_claims_seq_unique" UNIQUE("tenant_id","seq")
);
--> statement-breakpoint
ALTER TABLE "warranty_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "warranty_claims_status_idx" ON "warranty_claims" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "warranty_claims_serial_idx" ON "warranty_claims" USING btree ("tenant_id","serial");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "warranty_claims" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_status_check" CHECK (status IN ('received', 'sent', 'ready', 'delivered'));--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_number_unique" UNIQUE ("tenant_id", "number");--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "warranty_claims" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "warranty_claims" TO serva_app;
