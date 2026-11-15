-- The till's batch list now also carries the no-batch row when it is below zero (a count or a sale
-- that no batch covered), so the rows at the till add up to the stock it shows. Display only: the
-- till never allocates a sale from a row at or below zero, and stock, costing and postings do not
-- read this list. Every stock row is refreshed once so tills pull the corrected list.
CREATE OR REPLACE FUNCTION refresh_batch_cache(p_tenant uuid, p_branches uuid[] DEFAULT NULL, p_variants uuid[] DEFAULT NULL)
RETURNS void LANGUAGE sql AS $fn$
  WITH calc AS (
    SELECT l.id,
      coalesce((SELECT jsonb_agg(jsonb_build_object(
                'batchNo', nullif(m.batch_no, ''), 'expiry', m.expiry_date, 'qty', m.qty,
                'blocked', EXISTS (SELECT 1 FROM batch_blocks b
                                   WHERE b.tenant_id = l.tenant_id AND b.variant_id = l.variant_id
                                     AND b.batch_no = m.batch_no AND b.released_at IS NULL))
              ORDER BY m.expiry_date NULLS LAST, m.batch_no)
         FROM (SELECT batch_no, expiry_date, sum(qty) AS qty FROM batch_movements mv
               WHERE mv.tenant_id = l.tenant_id AND mv.branch_id = l.branch_id AND mv.variant_id = l.variant_id
               GROUP BY batch_no, expiry_date
               HAVING sum(qty) > 0 OR (batch_no = '' AND expiry_date IS NULL AND sum(qty) <> 0)) m),
         CASE WHEN EXISTS (SELECT 1 FROM batch_movements x WHERE x.tenant_id = l.tenant_id
                           AND x.branch_id = l.branch_id AND x.variant_id = l.variant_id)
              THEN '[]'::jsonb END) AS nb
    FROM stock_levels l
    WHERE l.tenant_id = p_tenant
      AND (p_branches IS NULL OR l.branch_id = ANY (p_branches))
      AND (p_variants IS NULL OR l.variant_id = ANY (p_variants)))
  UPDATE stock_levels l SET batches = c.nb
  FROM calc c
  WHERE l.tenant_id = p_tenant AND l.id = c.id AND l.batches IS DISTINCT FROM c.nb
$fn$;--> statement-breakpoint
SELECT refresh_batch_cache(t.id) FROM tenants t;
