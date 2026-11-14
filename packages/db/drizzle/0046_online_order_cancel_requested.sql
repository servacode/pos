-- «اطلب إلغاء الطلب»: a customer asks, from the order's page, to cancel an order the store has not
-- decided yet. The order waits in the owner's box in this state.
ALTER TABLE "online_orders" DROP CONSTRAINT "online_orders_status_check";--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_status_check" CHECK (status IN ('pending', 'cancel_requested', 'accepted', 'rejected', 'done'));
