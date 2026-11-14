ALTER TABLE "products" ADD COLUMN "requires_prescription" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "controlled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "pharmacy" jsonb;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "shelf_batches" jsonb;--> statement-breakpoint
-- «الأدوية المراقبة» (pharmacy.controlled): the owner's role holds it in every store; the owner grants it to the pharmacist.
UPDATE "roles" SET "permissions" = array_append("permissions", 'pharmacy.controlled')
WHERE "key" = 'owner' AND "is_system" AND NOT ('pharmacy.controlled' = ANY ("permissions"));
