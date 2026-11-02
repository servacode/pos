-- Task M0-3: received is not posted.
--
-- Until now every stored document was stamped processed_at on arrival, before any processor ran,
-- so the 18 of the 22 types nothing posts yet (return, receipt, customer, …) looked handled. From
-- here on processed_at is set only by a processor (sync-push.ts). This migration corrects the rows
-- already stored. It processes nothing: it only stops claiming that something was processed.
--
-- A row keeps processed_at only when everything its processor writes today is there. A row alone
-- is not enough: the four processors of phase 1 step 2 already wrote invoices, cash movements and
-- shifts, but journal entries only came with step 3 (0012_accounting, no backfill). A database that
-- ran step 2, a shop's own server for one, holds documents with their row and no entry. So:
--   sale          → invoices.id, and its journal entry
--   cash_movement → cash_movements.id, and its journal entry
--   shift_open    → shifts.id with opened_at set (a close that arrives first leaves it null);
--                   an opening posts no entry
--   shift_close   → shifts.close_doc_id, and its journal entry, unless every drawer balanced:
--                   a close with no difference posts nothing (posting.ts, shiftCloseLines)
-- A row and its entry are written in the same savepoint (sync-push.ts, one per document), so the
-- pair proves the processor ran to the end. Everything else loses processed_at, including phase-0
-- documents stored before any processor existed.
--
-- The test errs one way only. Marked held although nothing is missing: a second close of an
-- already closed shift, and a sale whose every line is zero (both post nothing by design). A false
-- "held" is reviewed and found harmless; a false "processed" would be a document never posted and
-- never looked at again.
--
-- Rows still accepted or waiting for a link are flagged held_for_processing, as new ones are.
-- Rejected and quarantined rows lose processed_at and gain no flag: they were never meant to post.
-- The catch-up that posts held documents is phase M1's (ADR register, task M0-3); it is never
-- done here or silently.
UPDATE "sync_inbox" AS i
SET "processed_at" = NULL
WHERE "processed_at" IS NOT NULL
  AND NOT (
    (i."doc_type" = 'sale'
      AND EXISTS (
        SELECT 1 FROM "invoices" v WHERE v."tenant_id" = i."tenant_id" AND v."id" = i."doc_id")
      AND EXISTS (
        SELECT 1 FROM "journal_entries" e
        WHERE e."tenant_id" = i."tenant_id" AND e."source_type" = 'sale' AND e."source_id" = i."doc_id"))
    OR (i."doc_type" = 'cash_movement'
      AND EXISTS (
        SELECT 1 FROM "cash_movements" c WHERE c."tenant_id" = i."tenant_id" AND c."id" = i."doc_id")
      AND EXISTS (
        SELECT 1 FROM "journal_entries" e
        WHERE e."tenant_id" = i."tenant_id" AND e."source_type" = 'cash_movement'
          AND e."source_id" = i."doc_id"))
    OR (i."doc_type" = 'shift_open' AND EXISTS (
      SELECT 1 FROM "shifts" s
      WHERE s."tenant_id" = i."tenant_id" AND s."id" = i."doc_id" AND s."opened_at" IS NOT NULL))
    OR (i."doc_type" = 'shift_close'
      AND EXISTS (
        SELECT 1 FROM "shifts" s WHERE s."tenant_id" = i."tenant_id" AND s."close_doc_id" = i."doc_id")
      AND (
        EXISTS (
          SELECT 1 FROM "journal_entries" e
          WHERE e."tenant_id" = i."tenant_id" AND e."source_type" = 'shift_close'
            AND e."source_id" = i."doc_id")
        -- Written so it cannot fail on any payload: rejected rows keep whatever the device sent,
        -- and SQL does not promise to test the conditions above first.
        OR NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(i."payload" -> 'payload' -> 'cash') = 'array'
              THEN i."payload" -> 'payload' -> 'cash' ELSE '[]'::jsonb END) AS d(drawer)
          WHERE coalesce(d.drawer ->> 'differenceBaseMinor', '0') <> '0')))
  );--> statement-breakpoint
UPDATE "sync_inbox"
SET "flags" = array_append("flags", 'held_for_processing')
WHERE "processed_at" IS NULL
  AND "status" IN ('accepted', 'pending_link')
  AND NOT ('held_for_processing' = ANY ("flags"));--> statement-breakpoint
COMMENT ON COLUMN "sync_inbox"."processed_at" IS 'When a processor posted the document; null while it waits for one (flag held_for_processing) or when it never posts (rejected, quarantined). Arrival is received_at.';
