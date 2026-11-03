-- Restaurants and cafés (03 › المطاعم، المقاهي): a product's modifiers («الحجم»، «الإضافات») and
-- what a store turns on at its tills: the hall's tables, order numbers and kitchen tickets.
ALTER TABLE "products" ADD COLUMN "modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "service" jsonb;