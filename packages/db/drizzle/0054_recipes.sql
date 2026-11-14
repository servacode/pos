CREATE TABLE "recipe_items" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"ingredient_variant_id" uuid NOT NULL,
	"qty" bigint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_items_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "recipe_items_ingredient_unique" UNIQUE("tenant_id","product_id","ingredient_variant_id")
);
--> statement-breakpoint
ALTER TABLE "recipe_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_items_product_idx" ON "recipe_items" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "recipe_items" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_qty_check" CHECK (qty > 0);--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "recipe_items" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "recipe_items" TO serva_app;
