ALTER TABLE "invoices" ADD COLUMN "commission_bp" integer;--> statement-breakpoint
-- Once: every sale so far keeps the seller's rate as of today, so history reads as it did before
UPDATE "invoices" i SET "commission_bp" = u."commission_bp" FROM "users" u WHERE u."tenant_id" = i."tenant_id" AND u."id" = coalesce(i."salesperson_id", i."cashier_id") AND u."commission_bp" IS NOT NULL;
