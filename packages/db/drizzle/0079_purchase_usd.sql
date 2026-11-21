ALTER TABLE "purchase_lines" ADD COLUMN "foreign_cost_minor" bigint;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "rate" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "foreign_total_minor" bigint;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "foreign_minor" bigint;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "rate" text;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "fx_minor" bigint;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD COLUMN "purchase_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD COLUMN "rate" text;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD COLUMN "foreign_amount_minor" bigint;--> statement-breakpoint
-- Round 36, decision 11 (purchasing in USD) and 13 (a supplier return at the invoice's cost). Everything is
-- additive: a purchase, payment or return with these columns empty is exactly what it was. The stock and the
-- cost stay in the base currency (cost_minor, total_minor, amount_minor keep their meaning); a dollar invoice
-- also keeps its dollars and the rate of the day, and the supplier's debt lives on 2100 lines in dollars.
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_currency_check" CHECK (("currency" IS NULL OR "currency" = 'USD') AND ("currency" IS NULL) = ("rate" IS NULL) AND ("currency" IS NULL) = ("foreign_total_minor" IS NULL));--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_currency_check" CHECK (("currency" IS NULL OR "currency" = 'USD') AND ("currency" IS NULL) = ("rate" IS NULL) AND ("currency" IS NULL) = ("foreign_minor" IS NULL) AND ("currency" IS NULL) = ("fx_minor" IS NULL));--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_currency_check" CHECK (("currency" IS NULL OR "currency" = 'USD') AND ("currency" IS NULL) = ("rate" IS NULL) AND ("currency" IS NULL) = ("foreign_amount_minor" IS NULL));--> statement-breakpoint
CREATE INDEX "supplier_returns_purchase_idx" ON "supplier_returns" ("tenant_id", "purchase_id") WHERE "purchase_id" IS NOT NULL;
