-- The start wizard (04 › معالج البداية) and the store settings: where the owner is in the wizard,
-- when they finished it, and the permission to change the store's settings.
ALTER TABLE "tenant_settings" ADD COLUMN "onboarding_step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
-- Stores opened before the wizard existed are past it: it shows only to new stores.
UPDATE "tenant_settings" SET "onboarded_at" = now(), "onboarding_step" = 4 WHERE "onboarded_at" IS NULL;--> statement-breakpoint
-- «إعدادات المتجر» (settings.manage), the owner's alone: added to every store's owner role.
UPDATE "roles" SET "permissions" = array_append("permissions", 'settings.manage')
WHERE "key" = 'owner' AND "is_system" AND NOT ('settings.manage' = ANY ("permissions"));
