/**
 * Opt-in correction for sale returns posted before «إلى حساب الزبون» existed.
 *
 * Until then a return of a credit sale (آجل) was paid back from the drawer in the books (Dr 4100,
 * Cr 1110) and the customer's debt on 1200 stayed as it was. If, in the shop, nobody handed that
 * cash over and the debt should have come down, this posts one correcting entry per return:
 *
 *     Dr 1110 the drawer's account (no shift)     Cr 1200 the customer (party)
 *
 * which turns the cash refund into a reduction of the debt. History is never rewritten: the old
 * entries stay, the correction is a new manual entry dated today with a memo naming the return.
 *
 *   pnpm --filter @serva/api correct-credit-returns --store=236961                 list only
 *   pnpm --filter @serva/api correct-credit-returns --store=236961 --apply         post
 *   pnpm --filter @serva/api correct-credit-returns --store=236961 --apply --returns=<id>,<id>
 *
 * Without --apply nothing is written. A return is a candidate when it was refunded in cash, its sale
 * names a customer and was (partly) on credit; the amount is capped at what the sale put on
 * credit, less what earlier corrected returns of it already took. It is safe to run twice: a
 * return that has its correction is skipped (the entry is unique by the return it corrects).
 * Review the list with the owner first: a return whose cash really did leave the drawer must NOT
 * be corrected, the books are right for it.
 *
 * Runs as the API's own role (DATABASE_URL, row-level security); finds stores as the owner
 * (DATABASE_MIGRATION_URL).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb, tenants, withTenant } from '@serva/db';
import { correctCreditReturns } from '../services/credit-return-correction';

const args = process.argv.slice(2);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = args.includes('--apply');
const storeCode = option('store');
const only = option('returns')?.split(',').filter(Boolean);

const envFile = [resolve('.env'), resolve('../../.env')].find((f) => existsSync(f));
if (envFile) process.loadEnvFile(envFile);
const appUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_MIGRATION_URL;
if (!storeCode || !appUrl || !ownerUrl) {
  console.error(
    'Usage: correct-credit-returns --store=<code> [--apply] [--returns=<id>,<id>] (DATABASE_URL and DATABASE_MIGRATION_URL set)',
  );
  process.exit(2);
}

const owner = createDb(ownerUrl, { max: 1, timeouts: false, applicationName: 'serva-correct-returns' });
const app = createDb(appUrl, { max: 1, timeouts: false, applicationName: 'serva-correct-returns' });
try {
  const [store] = await owner.db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.storeCode, storeCode));
  if (!store) throw new Error(`No store has the code ${storeCode}.`);
  const today = new Date().toISOString().slice(0, 10);
  const { items, posted } = await withTenant(app.db, store.id, (tx) =>
    correctCreditReturns(tx, store.id, { apply, today, only }),
  );
  console.log(`المتجر ${store.name}: ${items.length} مرتجعاً يحتاج تصحيحاً.`);
  for (const i of items) {
    console.log(
      `  - ${i.returnNumber} (فاتورة ${i.saleNumber}) ${i.customerName ?? i.customerId}: ${i.amountMinor} ${i.currency}`,
    );
  }
  console.log(apply ? `رُحّل ${posted} قيد تصحيح.` : 'عرض فقط. أضف --apply للترحيل.');
} catch (error) {
  console.error(`لم يكتمل: ${(error as Error).message}`);
  process.exitCode = 2;
} finally {
  await owner.client.end();
  await app.client.end();
}
