-- Online store, step 2 (26 › حياة الطلب): the order mode (WhatsApp or the shop itself, the phone
-- confirmed by a code), the customer's own page per order, the branch that holds its pieces once
-- accepted, the sale that delivered it, and the orders pulled to the tills.
ALTER TYPE "otp_purpose" ADD VALUE IF NOT EXISTS 'shop_order';--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "track_token" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "sale_id" uuid;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "change_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "order_mode" text DEFAULT 'whatsapp' NOT NULL;--> statement-breakpoint
CREATE INDEX "online_orders_change_xid_idx" ON "online_orders" USING btree ("tenant_id","change_xid","id");--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_track_unique" UNIQUE("tenant_id","track_token");--> statement-breakpoint
ALTER TABLE "online_stores" ADD CONSTRAINT "online_stores_order_mode_check" CHECK (order_mode IN ('whatsapp', 'shop'));--> statement-breakpoint
ALTER TABLE "online_orders" DROP CONSTRAINT "online_orders_status_check";--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_status_check" CHECK (status IN ('pending', 'accepted', 'rejected', 'done'));--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_source_check" CHECK (source IN ('whatsapp', 'shop'));--> statement-breakpoint
CREATE TRIGGER sync_change_xid BEFORE INSERT OR UPDATE ON "online_orders" FOR EACH ROW EXECUTE FUNCTION sync_touch_change_xid();--> statement-breakpoint
CREATE TRIGGER sync_tombstone AFTER DELETE ON "online_orders" FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone('online_orders', 'id');
