-- Pharmacies (03 › الصيدليات): a medicine's scientific name, the batch and expiry of each line
-- received, and on each item the earliest expiry of what is on the shelf, for the till's warning.
ALTER TABLE "products" ADD COLUMN "generic_name" text;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD COLUMN "batch_no" text;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD COLUMN "expiry_date" date;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "nearest_expiry" date;--> statement-breakpoint
CREATE INDEX "purchase_lines_variant_idx" ON "purchase_lines" USING btree ("tenant_id","variant_id");