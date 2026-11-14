CREATE TABLE "serial_sales" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"serial" text NOT NULL,
	"variant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"sold_on" date NOT NULL,
	"flag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serial_sales_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "serial_sales_unique" UNIQUE("tenant_id","serial","sale_id")
);
--> statement-breakpoint
ALTER TABLE "serial_sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "serials" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "serials" ADD COLUMN "change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD COLUMN "cost_minor" bigint;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD COLUMN "technician" text;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD COLUMN "loan_item" text;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD COLUMN "paid_repair" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD COLUMN "repair_sale_number" text;--> statement-breakpoint
ALTER TABLE "serial_sales" ADD CONSTRAINT "serial_sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "serial_sales_flag_idx" ON "serial_sales" USING btree ("tenant_id","flag");--> statement-breakpoint
CREATE INDEX "serials_change_xid_idx" ON "serials" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "serial_sales" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE TRIGGER sync_change_xid BEFORE INSERT OR UPDATE ON "serials" FOR EACH ROW EXECUTE FUNCTION sync_touch_change_xid();--> statement-breakpoint
CREATE TRIGGER sync_tombstone AFTER DELETE ON "serials" FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone('serials', 'id');--> statement-breakpoint
GRANT SELECT, INSERT ON "serial_sales" TO serva_app;--> statement-breakpoint
-- The branch of a received piece is its purchase's; every sale already made is in the history
UPDATE "serials" s SET branch_id = p.branch_id FROM "purchases" p WHERE p.tenant_id = s.tenant_id AND p.id = s.purchase_id;--> statement-breakpoint
INSERT INTO "serial_sales" (tenant_id, serial, variant_id, sale_id, sold_on)
  SELECT tenant_id, serial, variant_id, sale_id, sold_on FROM "serials" WHERE sale_id IS NOT NULL AND sold_on IS NOT NULL;
