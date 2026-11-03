-- Product pictures (03 › الألبسة: صور القطع; 26 › المتجر الإلكتروني): what a store uploads, resized
-- in the browser and kept here with a thumbnail, so the backup carries them; and each product's
-- pictures in order, one per colour where the shop says so.
CREATE TABLE "product_images" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"option_value" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_images_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "product_images_upload_unique" UNIQUE("tenant_id","product_id","upload_id")
);
--> statement-breakpoint
ALTER TABLE "product_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"sha256" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"thumb" "bytea" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uploads_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_tenant_id_product_id_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_tenant_id_upload_id_uploads_tenant_id_id_fk" FOREIGN KEY ("tenant_id","upload_id") REFERENCES "public"."uploads"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("tenant_id","product_id","sort_order");--> statement-breakpoint
CREATE INDEX "uploads_sha256_idx" ON "uploads" USING btree ("tenant_id","sha256");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "product_images" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "uploads" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "product_images" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
GRANT SELECT, INSERT ON "uploads" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_images" TO serva_app;
