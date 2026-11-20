-- Round 44, purchases: the invoice list now pages by (business_date, number) newest first, and the supplier
-- balances, the supplier-return checks and the suppliers' totals read these tables by supplier or by invoice
CREATE INDEX IF NOT EXISTS "purchases_list_order_idx" ON "purchases" USING btree ("tenant_id","business_date" DESC NULLS LAST,"number" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchases_supplier_idx" ON "purchases" USING btree ("tenant_id","supplier_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_returns_purchase_idx" ON "supplier_returns" USING btree ("tenant_id","purchase_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_returns_supplier_idx" ON "supplier_returns" USING btree ("tenant_id","supplier_id");
