/**
 * Posts the held documents of one type (task M1-4), once a processor for that type exists:
 *
 *   pnpm --filter @serva/api reprocess --type=return                 every store
 *   pnpm --filter @serva/api reprocess --type=return --store=236961  one store
 *
 * Each run is written to the store's audit log. Runs the work as the API's own role
 * (DATABASE_URL, row-level security) and finds the stores as the owner (DATABASE_MIGRATION_URL).
 * Exit code 0 when nothing failed, 1 when a document stayed held because its processor failed.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb, tenants } from '@serva/db';
import { DOCUMENT_PROCESSORS } from '../services/processors';
import { reprocessHeld } from '../services/reprocess';

const args = process.argv.slice(2);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const type = option('type');
const storeCode = option('store');

const envFile = [resolve('.env'), resolve('../../.env')].find((f) => existsSync(f));
if (envFile) process.loadEnvFile(envFile);
const appUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_MIGRATION_URL;
if (!type || !appUrl || !ownerUrl) {
  console.error(
    'Usage: reprocess --type=<document type> [--store=<code>] (DATABASE_URL and DATABASE_MIGRATION_URL set)',
  );
  process.exit(2);
}
if (!(type in DOCUMENT_PROCESSORS)) {
  console.error(
    `No processor for "${type}" yet: its documents stay held. Types with one: ${Object.keys(DOCUMENT_PROCESSORS).join(', ')}`,
  );
  process.exit(2);
}

const owner = createDb(ownerUrl, { max: 1, timeouts: false, applicationName: 'serva-reprocess' });
const app = createDb(appUrl, { max: 1, timeouts: false, applicationName: 'serva-reprocess' });
let failed = 0;
try {
  const stores = await owner.db
    .select({ id: tenants.id, code: tenants.storeCode, name: tenants.name })
    .from(tenants)
    .where(storeCode ? eq(tenants.storeCode, storeCode) : undefined);
  if (storeCode && stores.length === 0) throw new Error(`No store has the code ${storeCode}.`);
  for (const store of stores) {
    const report = await reprocessHeld(
      app.db,
      { tenantId: store.id, type, processors: DOCUMENT_PROCESSORS, now: new Date() },
      { ip: '127.0.0.1', userAgent: 'serva-reprocess' },
    );
    failed += report.failed.length;
    if (report.found === 0) continue;
    console.log(
      `المتجر ${store.code}: ${report.found} محجوزاً، رُحّل ${report.processed}، رُفض ${report.rejected.length}، بقي ${report.failed.length}`,
    );
    for (const f of report.failed) console.log(`  - ${f.docId}: ${f.error}`);
  }
  console.log(failed === 0 ? 'تم.' : `بقي ${failed} مستنداً محجوزاً بسبب خطأ. أعد التشغيل بعد إصلاحه.`);
} catch (error) {
  console.error(`لم يكتمل: ${(error as Error).message}`);
  process.exitCode = 2;
} finally {
  await owner.client.end();
  await app.client.end();
}
if (failed > 0 && !process.exitCode) process.exitCode = 1;
