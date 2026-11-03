-- Holds at the counter (03 › الألبسة: الحجز بعربون): pieces held for a customer as an accepted
-- order of the branch, its deposit paid as a voucher whose code the hold keeps.
ALTER TABLE "online_orders" ADD COLUMN "deposit_code" text;--> statement-breakpoint
ALTER TABLE "online_orders" DROP CONSTRAINT "online_orders_source_check";--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_source_check" CHECK (source IN ('whatsapp', 'shop', 'hold'));
