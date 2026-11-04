-- The price before a markdown (03 › الألبسة: ملصق قبل وبعد): kept by a bulk markdown, printed struck
-- through on the labels and shown in the shop; null when the piece is at its own price.
ALTER TABLE "prices" ADD COLUMN "was_price_minor" bigint;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_was_price_check" CHECK (was_price_minor IS NULL OR was_price_minor > 0);
