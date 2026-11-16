-- «عربون» (D4): an alteration or order deposit is its own document type (DEP) instead of a gift voucher.
-- Additive only: the journal and the voucher book accept one more source/kind; nothing is rewritten, and
-- the gift-voucher deposits already posted keep their rows as they are.
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_check";--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_check" CHECK ("source_type" IN ('sale', 'return', 'receipt', 'gift_voucher', 'deposit', 'purchase', 'supplier_payment', 'supplier_return', 'cost_of_sales', 'stocktake', 'transfer', 'cheque', 'expense', 'shift_close', 'cash_movement', 'manual', 'reversal'));--> statement-breakpoint
ALTER TABLE "vouchers" DROP CONSTRAINT "vouchers_kind_check";--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_kind_check" CHECK (kind IN ('exchange', 'gift', 'deposit'));
