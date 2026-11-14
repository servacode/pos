#!/usr/bin/env node
// One-off, idempotent: for every store/branch/item that keeps batches, makes the batch ledger
// (sum of batch_movements) equal the stock level, by appending one 'reconcile' row on the no-batch
// row ('' number, no expiry) for the difference. Stock, costing and postings are never touched.
// Run by hand where needed (not a migration):
//   node scripts/ops/reconcile-batches.mjs --dry-run     (prints what it would do)
//   node scripts/ops/reconcile-batches.mjs               (does it)
// Connects with DATABASE_MIGRATION_URL (the owner role), else DATABASE_URL.
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const postgres = require('postgres');

const dry = process.argv.includes('--dry-run');
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_MIGRATION_URL (or DATABASE_URL), e.g. from .env');
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });

const gapsSql = (tx, tenantId) => tx`
  select b.variant_id, b.branch_id, coalesce(sl.qty, 0)::bigint as stock, b.batches::bigint as batches,
         (coalesce(sl.qty, 0) - b.batches)::bigint as gap
  from (select variant_id, branch_id, sum(qty) as batches from batch_movements where tenant_id = ${tenantId} group by 1, 2) b
  left join stock_levels sl on sl.tenant_id = ${tenantId} and sl.variant_id = b.variant_id and sl.branch_id = b.branch_id
  where coalesce(sl.qty, 0) <> b.batches
  order by b.branch_id, b.variant_id`;

let total = 0;
const tenants = await sql`select id from tenants order by id`;
for (const t of tenants) {
  await sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${t.id}, true)`;
    const gaps = await gapsSql(tx, t.id);
    for (const g of gaps) {
      console.log(
        `${dry ? 'WOULD FIX' : 'FIX'} tenant ${t.id} branch ${g.branch_id} item ${g.variant_id}: stock ${g.stock}, batches ${g.batches}, reconcile row ${g.gap}`,
      );
      total += 1;
      if (dry) continue;
      await tx`
        insert into batch_movements (tenant_id, branch_id, variant_id, batch_no, expiry_date, qty, kind, doc_id, line_no, alloc_no, business_date)
        values (${t.id}, ${g.branch_id}, ${g.variant_id}, '', null, ${g.gap}, 'reconcile', uuid_generate_v7(), 1, 0, current_date)`;
    }
    if (!dry && gaps.length > 0) {
      const branches = [...new Set(gaps.map((g) => g.branch_id))];
      const variants = [...new Set(gaps.map((g) => g.variant_id))];
      await tx`select refresh_batch_cache(app_current_tenant(), ${branches}::uuid[], ${variants}::uuid[])`;
      await tx`select refresh_variant_expiry(app_current_tenant(), ${variants}::uuid[])`;
    }
  });
}
console.log(`${dry ? 'dry run: ' : ''}${total} difference(s) ${dry ? 'found' : 'fixed'}`);
await sql.end();
