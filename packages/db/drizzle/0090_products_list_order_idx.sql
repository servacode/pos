-- The products list pages by (name_ar, id) per store: without this index every page and every
-- search keystroke sorted the whole filtered set
CREATE INDEX IF NOT EXISTS "products_list_order_idx" ON "products" USING btree ("tenant_id","name_ar","id");
