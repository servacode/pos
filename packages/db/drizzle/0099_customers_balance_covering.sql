-- Round 54 (customers): a customer's balance is the sum of their 1200 lines. With debit and credit
-- stored in the index itself, the list, its totals and the debtors tile add the balances up from the
-- index alone (an index-only scan) and never visit the 200k ledger rows of a big store.
-- A plain create inside the migration's transaction: the project's migrations all run transactionally
-- (migrate.test.ts), and each index builds in seconds even at 200k lines (writes wait that long).
DROP INDEX IF EXISTS "journal_lines_customer_idx";--> statement-breakpoint
CREATE INDEX "journal_lines_customer_idx" ON "journal_lines" USING btree ("tenant_id","account_id","party_id") INCLUDE ("debit_minor","credit_minor") WHERE "journal_lines"."party_type" = 'customer';
--> statement-breakpoint
-- The list in name order (and the pickers' search) reads the first page by this index instead of sorting every customer.
DROP INDEX IF EXISTS "customers_name_idx";--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "customers" USING btree ("tenant_id","name","id");
