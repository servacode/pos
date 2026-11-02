-- Task M0-3: received is not posted.
--
-- Until now every stored document was stamped processed_at on arrival, before any processor ran,
-- so the 20 types nothing posts yet (return, receipt, customer, …) looked handled. From here on
-- processed_at is set only by a processor (sync-push.ts). This migration corrects the rows already
-- stored. It processes nothing: it only stops claiming that something was processed.
--
-- A row keeps processed_at only when the row its processor writes, keyed by the document's own
-- id, is there to prove it ran:
--   sale          → invoices.id
--   cash_movement → cash_movements.id
--   shift_open    → shifts.id with opened_at set (a close that arrives first leaves it null)
--   shift_close   → shifts.close_doc_id
-- Everything else, including phase-0 documents of those four types stored before their processor
-- existed, loses processed_at. The test errs one way only: a second close of an already closed
-- shift (which posts nothing by design) is marked held too. A false "held" is reviewed and found
-- harmless; a false "processed" would be a document never posted and never looked at again.
--
-- Rows still accepted or waiting for a link are flagged held_for_processing, as new ones are.
-- Rejected and quarantined rows lose processed_at and gain no flag: they were never meant to post.
-- The catch-up that posts held documents is phase M1's (ADR register, task M0-3); it is never
-- done here or silently.
UPDATE "sync_inbox" AS i
SET "processed_at" = NULL
WHERE "processed_at" IS NOT NULL
  AND NOT (
    (i."doc_type" = 'sale' AND EXISTS (
      SELECT 1 FROM "invoices" v WHERE v."tenant_id" = i."tenant_id" AND v."id" = i."doc_id"))
    OR (i."doc_type" = 'cash_movement' AND EXISTS (
      SELECT 1 FROM "cash_movements" c WHERE c."tenant_id" = i."tenant_id" AND c."id" = i."doc_id"))
    OR (i."doc_type" = 'shift_open' AND EXISTS (
      SELECT 1 FROM "shifts" s
      WHERE s."tenant_id" = i."tenant_id" AND s."id" = i."doc_id" AND s."opened_at" IS NOT NULL))
    OR (i."doc_type" = 'shift_close' AND EXISTS (
      SELECT 1 FROM "shifts" s WHERE s."tenant_id" = i."tenant_id" AND s."close_doc_id" = i."doc_id"))
  );--> statement-breakpoint
UPDATE "sync_inbox"
SET "flags" = array_append("flags", 'held_for_processing')
WHERE "processed_at" IS NULL
  AND "status" IN ('accepted', 'pending_link')
  AND NOT ('held_for_processing' = ANY ("flags"));--> statement-breakpoint
COMMENT ON COLUMN "sync_inbox"."processed_at" IS 'When a processor posted the document; null while it waits for one (flag held_for_processing) or when it never posts (rejected, quarantined). Arrival is received_at.';
