-- Round 48: a stopped offer frees its «كود الخصم»: the code is unique among offers that are not stopped (it was unique for ever, so «SUMMER10» could never be reused).
DROP INDEX IF EXISTS "promotions_coupon_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_coupon_unique" ON "promotions" USING btree ("tenant_id",lower("coupon_code")) WHERE "promotions"."coupon_code" is not null and "promotions"."archived_at" is null;
