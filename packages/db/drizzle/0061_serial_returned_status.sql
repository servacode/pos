-- A piece sent back to its supplier leaves the store's stock without being sold: it is «returned»
ALTER TABLE "serials" DROP CONSTRAINT "serials_status_check";--> statement-breakpoint
ALTER TABLE "serials" ADD CONSTRAINT "serials_status_check" CHECK ("status" IN ('in_stock', 'sold', 'rented', 'returned'));
