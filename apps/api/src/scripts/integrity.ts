/**
 * «فحص السلامة» from the command line (task M0-5): checks the books of every store on this
 * server, or of one, and prints their fingerprints. Read only: one read-only snapshot per store,
 * nothing is written or corrected. Runs as the owner role (DATABASE_MIGRATION_URL), which sees
 * every store.
 *
 *   pnpm --filter @serva/api integrity                 every store
 *   pnpm --filter @serva/api integrity --store=236961  one store, by its 6-digit code
 *   pnpm --filter @serva/api integrity --json          the full report as JSON
 *
 * Exit code 0 when every check passed, 1 when a problem was found, 2 when it could not run.
 * Two servers holding the same documents print the same fingerprints (after a restore or an
 * upgrade, say): that is how the restore drill and the upgrade test compare them.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { asc, eq, sql } from 'drizzle-orm';
import { createDb, tenants } from '@serva/db';
import { checkIntegrity, type IntegrityReport } from '../services/integrity';

const CHECK_NAMES: Record<string, string> = {
  entries_balanced: 'كل قيد متوازن',
  journal_numbering: 'أرقام القيود متسلسلة بلا فجوات',
  stock_movements: 'المخزون = مجموع حركاته',
  drawer_ledger: 'الصندوق في الدفتر = حركة الدرج حسب المستندات',
  day_report_ledger: 'تقرير اليوم = الدفتر',
};

const args = process.argv.slice(2);
const json = args.includes('--json');
const storeCode = args.find((a) => a.startsWith('--store='))?.slice('--store='.length);

const envFile = [resolve('.env'), resolve('../../.env')].find((f) => existsSync(f));
if (envFile) process.loadEnvFile(envFile);

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error('DATABASE_MIGRATION_URL is not set');
  process.exit(2);
}

const { db, client } = createDb(url, { max: 1, timeouts: false, applicationName: 'serva-integrity' });
try {
  const stores = await db
    .select({ id: tenants.id, code: tenants.storeCode, name: tenants.name })
    .from(tenants)
    .where(storeCode ? eq(tenants.storeCode, storeCode) : undefined)
    .orderBy(asc(tenants.storeCode));
  if (storeCode && stores.length === 0) {
    console.error(`No store has the code ${storeCode}.`);
    process.exit(2);
  }

  const reports: (IntegrityReport & { storeCode: string; name: string })[] = [];
  for (const store of stores) {
    const report = await db.transaction(async (tx) => {
      // One consistent snapshot per store, and a guarantee that nothing is written.
      await tx.execute(sql`set transaction isolation level repeatable read, read only`);
      return checkIntegrity(tx, store.id);
    });
    reports.push({ ...report, storeCode: store.code, name: store.name });
  }

  if (json) {
    console.log(JSON.stringify({ ok: reports.every((r) => r.ok), stores: reports }, null, 2));
  } else {
    if (reports.length === 0) console.log('لا متاجر على هذا الخادم بعد.');
    for (const r of reports) {
      console.log(`\n${r.ok ? '✔' : '✘'} المتجر ${r.storeCode} — ${r.name}`);
      for (const c of r.checks) {
        console.log(`  ${c.ok ? '✔' : '✘'} ${CHECK_NAMES[c.name] ?? c.name}`);
        for (const p of c.problems) console.log(`      - ${p}`);
      }
      console.log(`  بصمة الدفتر:  ${r.ledger.hash} (${r.ledger.rows} قيداً)`);
      console.log(`  بصمة المخزون: ${r.stock.hash} (${r.stock.rows} سطراً)`);
    }
    const failed = reports.filter((r) => !r.ok).length;
    console.log(
      failed === 0
        ? `\nسليم: ${reports.length} متجراً، كل الفحوص ناجحة.`
        : `\nانتبه: ${failed} من ${reports.length} متجراً فيه مشكلة. لم يُصحَّح شيء.`,
    );
  }
  process.exitCode = reports.every((r) => r.ok) ? 0 : 1;
} catch (error) {
  console.error(`فحص السلامة لم يكتمل: ${(error as Error).message}`);
  process.exitCode = 2;
} finally {
  await client.end();
}
