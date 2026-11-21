ALTER TABLE "product_texts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Like every table with updated_at: the row-version trigger keeps version and updated_at (catalog.test.ts schema conventions).
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "product_texts" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
