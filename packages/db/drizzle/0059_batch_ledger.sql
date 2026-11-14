CREATE TABLE "batch_blocks" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"reason" text,
	"blocked_by" uuid,
	"blocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_blocks_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "batch_blocks_batch_unique" UNIQUE("tenant_id","variant_id","batch_no")
);
--> statement-breakpoint
ALTER TABLE "batch_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "batch_movements" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"batch_no" text DEFAULT '' NOT NULL,
	"expiry_date" date,
	"qty" bigint NOT NULL,
	"kind" text NOT NULL,
	"doc_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"alloc_no" integer DEFAULT 0 NOT NULL,
	"business_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_movements_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "batch_movements_line_unique" UNIQUE("tenant_id","kind","doc_id","line_no","alloc_no")
);
--> statement-breakpoint
ALTER TABLE "batch_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "requires_expiry" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD COLUMN "batches" jsonb;--> statement-breakpoint
ALTER TABLE "batch_blocks" ADD CONSTRAINT "batch_blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_blocks" ADD CONSTRAINT "batch_blocks_tenant_id_variant_id_variants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."variants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_movements" ADD CONSTRAINT "batch_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_movements" ADD CONSTRAINT "batch_movements_tenant_id_branch_id_branches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batch_movements_balance_idx" ON "batch_movements" USING btree ("tenant_id","variant_id","branch_id");--> statement-breakpoint
CREATE INDEX "batch_movements_batch_idx" ON "batch_movements" USING btree ("tenant_id","batch_no");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "batch_blocks" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "batch_movements" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "batch_movements" ADD CONSTRAINT "batch_movements_qty_check" CHECK (qty <> 0);--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON "batch_movements" FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER bump_row_version BEFORE UPDATE ON "batch_blocks" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
GRANT SELECT, INSERT ON "batch_movements" TO serva_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "batch_blocks" TO serva_app;--> statement-breakpoint
-- What is left of each batch in a branch, written on the item's stock level row (the till reads it).
-- Only rows whose list changed are touched, so a sale that leaves the list as it was moves nothing.
CREATE FUNCTION refresh_batch_cache(p_tenant uuid, p_branches uuid[] DEFAULT NULL, p_variants uuid[] DEFAULT NULL)
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
               GROUP BY batch_no, expiry_date HAVING sum(qty) > 0) m),
         -- no batch left but the item keeps batches here: an empty list, so the till knows nothing valid is left
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
-- The earliest expiry on the shelf and the batches on it, written on the item (the till's warning).
CREATE FUNCTION refresh_variant_expiry(p_tenant uuid, p_variants uuid[] DEFAULT NULL)
RETURNS void LANGUAGE sql AS $fn$
  WITH held AS (
    SELECT DISTINCT variant_id, batch_no, expiry_date FROM (
      SELECT variant_id, branch_id, batch_no, expiry_date FROM batch_movements
      WHERE tenant_id = p_tenant AND (p_variants IS NULL OR variant_id = ANY (p_variants))
      GROUP BY variant_id, branch_id, batch_no, expiry_date HAVING sum(qty) > 0) s),
  calc AS (
    SELECT v.id, min(h.expiry_date)::date AS nearest,
           jsonb_agg(jsonb_build_object('batchNo', nullif(h.batch_no, ''), 'expiry', h.expiry_date)
                     ORDER BY h.expiry_date, h.batch_no) FILTER (WHERE h.expiry_date IS NOT NULL) AS batches
    FROM variants v LEFT JOIN held h ON h.variant_id = v.id
    WHERE v.tenant_id = p_tenant AND (p_variants IS NULL OR v.id = ANY (p_variants))
    GROUP BY v.id)
  UPDATE variants v SET nearest_expiry = c.nearest, shelf_batches = c.batches
  FROM calc c
  WHERE v.tenant_id = p_tenant AND v.id = c.id
    AND (v.nearest_expiry IS DISTINCT FROM c.nearest OR v.shelf_batches IS DISTINCT FROM c.batches)
$fn$;--> statement-breakpoint
-- The batch ledger for a store that had none, from what it holds (this migration runs it once per
-- store; a store that already has ledger rows is left alone):
--   1. every purchase line with a batch number or an expiry is a receipt;
--   2. every sale line with a batch (batches[] or the older batchNo) takes its batch down, and
--      what a return took back goes onto the batch of the sale line it came from;
--   3. what left stock with no batch on it (old tills, supplier returns, counts, transfers) is
--      taken first-in-first-out: first from stock with no batch (opening stock, receipts without
--      a batch), then from the batches in the order received, skipping a batch that is already
--      expired today, so an expired batch that was never really sold stays on the report.
CREATE FUNCTION backfill_batch_ledger(p_tenant uuid) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM batch_movements WHERE tenant_id = p_tenant) THEN RETURN; END IF;

  INSERT INTO batch_movements (tenant_id, branch_id, variant_id, batch_no, expiry_date, qty, kind, doc_id, line_no, business_date)
  SELECT l.tenant_id, p.branch_id, l.variant_id, coalesce(l.batch_no, ''), l.expiry_date, l.qty, 'receipt', p.id, l.line_no, p.business_date
  FROM purchase_lines l JOIN purchases p ON p.tenant_id = l.tenant_id AND p.id = l.purchase_id
  WHERE l.tenant_id = p_tenant AND l.qty <> 0 AND (l.batch_no IS NOT NULL OR l.expiry_date IS NOT NULL)
  ON CONFLICT DO NOTHING;

  INSERT INTO batch_movements (tenant_id, branch_id, variant_id, batch_no, expiry_date, qty, kind, doc_id, line_no, alloc_no, business_date)
  SELECT i.tenant_id, i.branch_id, (l ->> 'variantId')::uuid,
         coalesce(a ->> 'batchNo', ''), nullif(a ->> 'expiry', '')::date,
         -(a ->> 'qty')::bigint, 'sale', i.id, (l ->> 'lineNo')::int, (n - 1)::int, i.business_date
  FROM invoices i
  CROSS JOIN LATERAL jsonb_array_elements(i.payload -> 'lines') l
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(l -> 'batches') = 'array' AND jsonb_array_length(l -> 'batches') > 0 THEN l -> 'batches'
         WHEN coalesce(l ->> 'batchNo', '') <> ''
           THEN jsonb_build_array(jsonb_build_object('batchNo', l ->> 'batchNo', 'expiry', l ->> 'batchExpiry', 'qty', l ->> 'baseQty'))
         ELSE '[]'::jsonb END) WITH ORDINALITY AS t(a, n)
  WHERE i.tenant_id = p_tenant AND (a ->> 'qty')::bigint > 0
  ON CONFLICT DO NOTHING;

  INSERT INTO batch_movements (tenant_id, branch_id, variant_id, batch_no, expiry_date, qty, kind, doc_id, line_no, business_date)
  SELECT r.tenant_id, r.branch_id, rl.variant_id, s.batch_no, s.expiry_date, rl.base_qty, 'return', r.id, rl.line_no, r.business_date
  FROM sale_returns r
  JOIN sale_return_lines rl ON rl.tenant_id = r.tenant_id AND rl.return_id = r.id
  JOIN LATERAL (
    SELECT bm.batch_no, bm.expiry_date FROM batch_movements bm
    WHERE bm.tenant_id = r.tenant_id AND bm.kind = 'sale' AND bm.doc_id = r.sale_id AND bm.line_no = rl.sale_line_no
    ORDER BY bm.alloc_no LIMIT 1) s ON true
  WHERE r.tenant_id = p_tenant AND rl.base_qty > 0
  ON CONFLICT DO NOTHING;

  INSERT INTO batch_movements (tenant_id, branch_id, variant_id, batch_no, expiry_date, qty, kind, doc_id, line_no, alloc_no, business_date)
  SELECT p_tenant, q.branch_id, q.variant_id, q.batch_no, q.expiry_date, -q.take, 'backfill', q.variant_id, 0,
         (row_number() OVER (PARTITION BY q.variant_id ORDER BY q.branch_id, q.first_date, q.expiry_date, q.batch_no))::int,
         current_date
  FROM (
    SELECT b.*, least(b.rem, greatest(0, b.untagged - coalesce(sum(b.rem) OVER (
             PARTITION BY b.branch_id, b.variant_id ORDER BY b.first_date, b.expiry_date, b.batch_no
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0))) AS take
    FROM (
      SELECT g.*, greatest(0, (o.out_all - g.tagged_out) - (o.ret_in - g.tagged_ret) - greatest(0, o.all_in - o.ret_in - g.received)) AS untagged
      FROM (
        SELECT branch_id, variant_id, batch_no, expiry_date, sum(qty) AS rem,
               coalesce(sum(sum(qty) FILTER (WHERE kind = 'receipt')) OVER (PARTITION BY branch_id, variant_id), 0) AS received,
               -coalesce(sum(sum(qty) FILTER (WHERE kind = 'sale')) OVER (PARTITION BY branch_id, variant_id), 0) AS tagged_out,
               coalesce(sum(sum(qty) FILTER (WHERE kind = 'return')) OVER (PARTITION BY branch_id, variant_id), 0) AS tagged_ret,
               min(business_date) FILTER (WHERE kind = 'receipt') AS first_date
        FROM batch_movements WHERE tenant_id = p_tenant
        GROUP BY branch_id, variant_id, batch_no, expiry_date) g
      JOIN (
        SELECT branch_id, variant_id,
               -coalesce(sum(qty) FILTER (WHERE qty < 0), 0) AS out_all,
               coalesce(sum(qty) FILTER (WHERE kind = 'return'), 0) AS ret_in,
               coalesce(sum(qty) FILTER (WHERE qty > 0), 0) AS all_in
        FROM stock_movements WHERE tenant_id = p_tenant GROUP BY branch_id, variant_id) o
        ON o.branch_id = g.branch_id AND o.variant_id = g.variant_id
    ) b
    WHERE b.rem > 0 AND (b.expiry_date IS NULL OR b.expiry_date >= current_date)
  ) q
  WHERE q.take > 0;

  PERFORM refresh_batch_cache(p_tenant);
  PERFORM refresh_variant_expiry(p_tenant);
END
$fn$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION refresh_batch_cache(uuid, uuid[], uuid[]), refresh_variant_expiry(uuid, uuid[]) TO serva_app;--> statement-breakpoint
SELECT backfill_batch_ledger(t.id) FROM tenants t;
