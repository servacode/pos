ALTER TABLE "stock_movements" ADD COLUMN "cost_branch_id" uuid;--> statement-breakpoint
-- «البضاعة التالفة» (round 35, D7): a branch's damaged goods sit in a hidden location of their own, a
-- branch of kind 'damaged' whose parent is the store (a van's damaged goods go to its home store). It
-- is an ordinary branch for stock, cost, stocktakes and supplier returns, and so the sellable stock
-- of the real branch never includes it; every list of stores already leaves non-store kinds out.
-- Nothing existing changes: no branch has the new kind until a return is marked damaged.
ALTER TABLE "branches" DROP CONSTRAINT "branches_kind_check";--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_kind_check" CHECK ("kind" IN ('store', 'van', 'damaged'));--> statement-breakpoint
ALTER TABLE "branches" DROP CONSTRAINT "branches_parent_check";--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_parent_check" CHECK (("kind" IN ('van', 'damaged') OR "parent_branch_id" IS NULL) AND ("kind" <> 'damaged' OR "parent_branch_id" IS NOT NULL) AND "parent_branch_id" IS DISTINCT FROM "id");--> statement-breakpoint
-- One damaged location per store, whoever makes it first
CREATE UNIQUE INDEX "branches_damaged_parent_unique" ON "branches" ("tenant_id", "parent_branch_id") WHERE "kind" = 'damaged';
