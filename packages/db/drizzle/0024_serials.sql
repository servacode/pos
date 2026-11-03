-- Electronics and phones (03 › الإلكترونيات والجوالات): products sold piece by piece by their serial
-- number or IMEI, with a warranty in months, and the store's serials: received by a purchase, sold
-- by a sale line that names them.
CREATE TABLE "serials" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"serial" text NOT NULL,
	"status" text NOT NULL,
	"purchase_id" uuid,
	"sale_id" uuid,
	"sold_on" date,
	"warranty_until" date,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serials_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "serials_serial_unique" UNIQUE("tenant_id","serial")
);
--> statement-breakpoint
ALTER TABLE "serials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tracks_serial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "warranty_months" integer;--> statement-breakpoint
ALTER TABLE "serials" ADD CONSTRAINT "serials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "serials_variant_idx" ON "serials" USING btree ("tenant_id","variant_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "serials" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "serials" ADD CONSTRAINT "serials_status_check" CHECK ("status" IN ('in_stock', 'sold'));--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "serials" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "serials" TO serva_app;
