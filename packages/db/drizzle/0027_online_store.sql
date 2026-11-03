-- The online shop (26 › المتجر الإلكتروني): each store's link and settings, found without sign-in
-- by shop_find_by_slug(), and the orders its customers send, saved before WhatsApp opens.
CREATE TABLE "online_orders" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'whatsapp' NOT NULL,
	"customer_name" text NOT NULL,
	"phone" text NOT NULL,
	"fulfilment" text NOT NULL,
	"address" text,
	"note" text,
	"currency" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"lines" jsonb NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_orders_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "online_orders_seq_unique" UNIQUE("tenant_id","seq")
);
--> statement-breakpoint
ALTER TABLE "online_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "online_stores" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"whatsapp" text,
	"delivery" boolean DEFAULT true NOT NULL,
	"pickup" boolean DEFAULT true NOT NULL,
	"note" text,
	"show_out_of_stock" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "online_stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_stores" ADD CONSTRAINT "online_stores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "online_orders_status_idx" ON "online_orders" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "online_stores_slug_unique" ON "online_stores" USING btree ("slug");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "online_orders" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "online_stores" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "online_stores" ADD CONSTRAINT "online_stores_slug_check" CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$');--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_status_check" CHECK (status IN ('pending', 'accepted', 'rejected', 'done'));--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_fulfilment_check" CHECK (fulfilment IN ('delivery', 'pickup'));--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_total_check" CHECK (total_minor >= 0);--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "online_stores" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "online_orders" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
-- The store behind a shop link, when its shop is on; nothing else of the row leaves the function
CREATE FUNCTION shop_find_by_slug(p_slug text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.tenant_id FROM online_stores s WHERE s.slug = lower(trim(p_slug)) AND s.enabled
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION shop_find_by_slug(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION shop_find_by_slug(text) TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "online_stores" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "online_orders" TO serva_app;
