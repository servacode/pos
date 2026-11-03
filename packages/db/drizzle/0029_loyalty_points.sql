-- Loyalty points (03 › الألبسة: نقاط الولاء): the store's rates, and each customer's points earned
-- less spent, kept by the sale processor; the rebuild sets them to zero and replays the sales.
ALTER TABLE "customers" ADD COLUMN "loyalty_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "loyalty" jsonb;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_loyalty_points_check" CHECK (loyalty_points >= -1000000000);
