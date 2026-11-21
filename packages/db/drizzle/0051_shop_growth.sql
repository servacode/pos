CREATE TABLE "product_texts" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"description" text,
	"size_guide" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_texts_pkey" PRIMARY KEY("tenant_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "product_texts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_alerts" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_alerts_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "stock_alerts_variant_phone_unique" UNIQUE("tenant_id","variant_id","phone")
);
--> statement-breakpoint
ALTER TABLE "stock_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "delivery_stage" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "courier_name" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "coupon_code" text;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "tagline" text;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "logo_upload_id" uuid;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "cover_upload_id" uuid;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "accent" text DEFAULT 'emerald' NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "coupon_code" text;--> statement-breakpoint
ALTER TABLE "product_texts" ADD CONSTRAINT "product_texts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_texts" ADD CONSTRAINT "product_texts_tenant_id_product_id_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_tenant_id_product_id_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_tenant_id_variant_id_variants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."variants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_alerts_product_idx" ON "stock_alerts" USING btree ("tenant_id","product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_coupon_unique" ON "promotions" USING btree ("tenant_id",lower("coupon_code")) WHERE "promotions"."coupon_code" is not null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "product_texts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_alerts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
-- Hand-written: the delivery stage is one of two words, the accent one of the identity's families,
-- and the store's role may read and write the two new tables (the policies above keep it to its own store).
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_delivery_stage_check" CHECK (delivery_stage IN ('out', 'delivered'));--> statement-breakpoint
ALTER TABLE "online_stores" ADD CONSTRAINT "online_stores_accent_check" CHECK (accent IN ('emerald', 'teal', 'blue'));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "product_texts" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_alerts" TO serva_app;
