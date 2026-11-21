-- Round 50 (customers): what every customer owes is the sum of their 1200 lines; this index lets the
-- list, its totals and the debtors tile read those lines by customer instead of scanning every line of the account.
CREATE INDEX IF NOT EXISTS "journal_lines_customer_idx" ON "journal_lines" USING btree ("tenant_id","account_id","party_id") WHERE "journal_lines"."party_type" = 'customer';
