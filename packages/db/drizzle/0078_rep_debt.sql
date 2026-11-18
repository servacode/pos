ALTER TABLE "rep_settlements" ADD COLUMN "rep_debt" jsonb;--> statement-breakpoint
-- «ذمة المندوب» (round 35, D6): a cash shortage the supervisor settles as the rep's debt is moved off the
-- cash-difference loss (6200) onto the rep's account in 1250, by one entry of its own (rep_settlement);
-- what the rep pays back, or the owner forgives, is the entry rep_debt. Old entries keep their types.
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_check";--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_check" CHECK ("source_type" IN ('sale', 'return', 'receipt', 'gift_voucher', 'deposit', 'purchase', 'supplier_payment', 'supplier_return', 'cost_of_sales', 'stocktake', 'transfer', 'cheque', 'expense', 'shift_close', 'cash_movement', 'rep_settlement', 'rep_debt', 'manual', 'reversal'));
