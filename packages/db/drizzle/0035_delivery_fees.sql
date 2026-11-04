-- Delivery fees of the online shop (03 › الألبسة: أجرة التوصيل): flat or per area, added to a delivered
-- order for the customer to pay the courier; not a sale of the store, so no entry.
ALTER TABLE "online_orders" ADD COLUMN "delivery_fee_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "delivery_area" text;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "delivery_fee_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "delivery_areas" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "online_stores" ADD CONSTRAINT "online_stores_delivery_fee_check" CHECK (delivery_fee_minor >= 0);--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_delivery_fee_check" CHECK (delivery_fee_minor >= 0);
