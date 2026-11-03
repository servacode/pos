-- Gift vouchers (03 › الألبسة: قسيمة هدية): a voucher sold at the till sits beside the exchange
-- vouchers, with the shift and the method it was paid by, so the drawer count takes its cash.
ALTER TABLE "vouchers" ADD COLUMN "kind" text DEFAULT 'exchange' NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "method" text;--> statement-breakpoint
CREATE INDEX "vouchers_shift_idx" ON "vouchers" USING btree ("tenant_id","shift_id");--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_kind_check" CHECK (kind IN ('exchange', 'gift'));--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_check";--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_check" CHECK ("source_type" IN ('sale', 'return', 'receipt', 'gift_voucher', 'purchase', 'supplier_payment', 'cost_of_sales', 'stocktake', 'cheque', 'shift_close', 'cash_movement', 'manual', 'reversal'));
