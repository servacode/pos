import { sql, type SQL } from 'drizzle-orm';

/**
 * Round 36 (decision 10): the drawers a cash refund came out of. A return's refund names, besides
 * its whole amount in the invoice currency, what left a foreign drawer (the dollar's) in
 * `payload.refunds[0].foreign`. This is one row per drawer: the foreign currency's own amount, and
 * the invoice currency's drawer with the refund less the foreign part's value. A refund with no
 * foreign part, every one made before, is one row for the whole amount, as it always was.
 *
 * Positive amounts; the caller signs them. `where` filters `sale_returns r`.
 */
export function cashRefundDrawers(where: SQL): SQL {
  const foreign = sql`(case when jsonb_typeof(r.payload -> 'refunds' -> 0 -> 'foreign') = 'array'
                            then r.payload -> 'refunds' -> 0 -> 'foreign' else '[]'::jsonb end)`;
  return sql`
    select r.shift_id, d.currency, d.amount
    from sale_returns r
    cross join lateral (
      select r.currency as currency,
             coalesce((r.payload -> 'refunds' -> 0 ->> 'amountMinor')::bigint, r.total_minor)
               - coalesce((select sum((f ->> 'baseAmountMinor')::bigint) from jsonb_array_elements(${foreign}) f), 0)
               as amount
      union all
      select f ->> 'currency', (f ->> 'amountMinor')::bigint
      from jsonb_array_elements(${foreign}) f
    ) d
    where ${where} and r.refund_method = 'cash' and d.amount <> 0`;
}
