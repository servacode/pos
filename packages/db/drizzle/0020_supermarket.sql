-- The supermarket mode (03 › المولات والسوبرماركت): automatic promotions that every till pulls and
-- applies by itself, and how the store's scales print their labels («باركود الميزان»).
CREATE TABLE "promotions" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"percent_bp" integer,
	"buy_qty" integer,
	"get_qty" integer,
	"scope" text NOT NULL,
	"category_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"product_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"days_of_week" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"from_time" text,
	"to_time" text,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	CONSTRAINT "promotions_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "promotions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "scale_barcode" jsonb;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promotions_change_xid_idx" ON "promotions" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "promotions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_kind_check" CHECK ("kind" IN ('percent', 'buy_get'));--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_scope_check" CHECK ("scope" IN ('all', 'categories', 'products'));--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "promotions" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER sync_change_xid BEFORE INSERT OR UPDATE ON "promotions" FOR EACH ROW EXECUTE FUNCTION sync_touch_change_xid();--> statement-breakpoint
CREATE TRIGGER sync_tombstone AFTER DELETE ON "promotions" FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone('promotions', 'id');--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "promotions" TO serva_app;
