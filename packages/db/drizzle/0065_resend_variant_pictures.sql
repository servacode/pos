-- The picture sent with each piece to the tills was chosen with its product matched wrongly, so a piece
-- could carry another product's picture (fixed in sync-pull.ts). Touch the pieces of every store that
-- has pictures so its tills pull the right one; nothing else changes.
UPDATE "variants" SET "updated_at" = now()
WHERE EXISTS (SELECT 1 FROM "product_images" i WHERE i.tenant_id = "variants".tenant_id);
