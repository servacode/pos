-- Round 44, inventory: the transfers list now always reads the transfers still on the way (whatever their age) and
-- pages the rest newest first; the list of counts already made pages by date. Nothing here is needed for the code to work.
CREATE INDEX IF NOT EXISTS "transfers_list_order_idx" ON "transfers" USING btree ("tenant_id","business_date" DESC NULLS LAST,"created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transfers_in_transit_idx" ON "transfers" USING btree ("tenant_id") WHERE "in_transit";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stocktakes_list_order_idx" ON "stocktakes" USING btree ("tenant_id","business_date" DESC NULLS LAST,"created_at" DESC NULLS LAST);
