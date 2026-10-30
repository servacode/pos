-- Replaced in 0006: the typed referral code by a verified agent_id, and the single cash rounding
-- amount by a step per currency.
ALTER TABLE "tenant_settings" DROP COLUMN "cash_rounding_minor";--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN "referral_code";
