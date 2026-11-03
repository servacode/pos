import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { migrationsFolder, readMigrations, runMigrations, withTenant } from '@serva/db';
import type { SyncDocument } from '@serva/sync';
import { checkIntegrity, type IntegrityReport } from '../../src/services/integrity';
import {
  cartLine,
  documents,
  makeProduct,
  movement,
  push,
  sale,
  shiftClose,
  shiftOpen,
  type DrawerTerms,
  type Store,
} from '../accounting-fixtures';
import { createDevice, type TestDevice } from '../devices';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, storeInput } from '../helpers';
import { TEST_APP_URL, TEST_OWNER_URL } from '../urls';
import { previousCommit, startPreviousServer, type PreviousServer } from './previous-server';

/**
 * Task M0-4: upgrading a store's server from the previous version of the schema (N−1) to this one
 * (N) changes nothing in its books.
 *
 * The database is rebuilt from nothing at N−1 (every migration but the last), filled through the
 * real push route with a working day of four tills, 2,000 invoices in all (cash in two currencies,
 * card, wallet, change in dollars, discounts, drawer movements, closes short and over), then
 * migrated to N. Before and after, the integrity check of services/integrity.ts must pass and the
 * fingerprints of the ledger and of the stock must be the same; every row must still be there, and
 * the upgraded server must go on taking sales.
 *
 * The books at N−1 are written by the previous version's own code (previous-server.ts: the
 * commit before the latest migration, started from the repository's history), as a shop's server
 * holds them when the update arrives. The new code meets the database only once it is migrated,
 * as deploy/local/compose.yml runs it.
 */

const INVOICES = 2_000;
const TILLS = 4;
const PER_TILL = INVOICES / TILLS;
const BATCH = 50;
const PRICES = [125_000, 37_500, 2_250_000, 9_000];
const COUNTED_TABLES = [
  'invoices',
  'invoice_lines',
  'invoice_payments',
  'cash_movements',
  'shifts',
  'stock_movements',
  'stock_levels',
  'journal_entries',
  'journal_lines',
  'sync_inbox',
  'devices',
] as const;

let app: FastifyInstance | undefined;
let previousServer: PreviousServer | undefined;
let previousFolder: string | undefined;
afterAll(async () => {
  await previousServer?.stop();
  await app?.close();
  await closeAppDb();
  await closeOwnerDb();
  if (previousFolder) rmSync(previousFolder, { recursive: true, force: true });
});

/** The migrations folder as it was one migration ago. */
function previousMigrations(): { folder: string; last: string } {
  const all = readMigrations();
  const last = all.at(-1)!.tag;
  const folder = mkdtempSync(join(tmpdir(), 'serva-n-1-'));
  cpSync(migrationsFolder, folder, { recursive: true });
  const journalFile = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((e) => e.tag !== last);
  writeFileSync(journalFile, JSON.stringify(journal));
  rmSync(join(folder, `${last}.sql`));
  return { folder, last };
}

/** Drops everything and migrates to the schema in `folder`. */
async function rebuildAt(folder: string): Promise<string[]> {
  // It drops every table: never anything but the upgrade test's own database.
  if (!new URL(TEST_OWNER_URL).pathname.endsWith('_upgrade_test')) {
    throw new Error(
      `Refusing to rebuild ${new URL(TEST_OWNER_URL).pathname}: not an *_upgrade_test database`,
    );
  }
  const sql = postgres(TEST_OWNER_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`drop schema if exists drizzle cascade`;
    await sql`drop schema if exists public cascade`;
    await sql`create schema public`;
  } finally {
    await sql.end();
  }
  return runMigrations(TEST_OWNER_URL, { migrationsFolder: folder });
}

/** A store signed up on `on`, with the code its test mode shows, and its first till. */
async function openStoreOn(on: FastifyInstance, phone: string): Promise<Store> {
  const input = storeInput({ phone });
  const start = await on.inject({ method: 'POST', url: '/v1/auth/register', payload: input });
  if (start.statusCode !== 202) throw new Error(`register failed: ${start.statusCode} ${start.body}`);
  const { registrationId, testCode } = start.json<{ registrationId: string; testCode: string }>();
  const res = await on.inject({
    method: 'POST',
    url: '/v1/auth/register/verify',
    payload: { registrationId, code: testCode, password: input.password },
  });
  if (res.statusCode !== 201) throw new Error(`register/verify failed: ${res.statusCode} ${res.body}`);
  const body = res.json<{ tenant: { id: string }; user: { id: string }; accessToken: string }>();
  return {
    tenantId: body.tenant.id,
    userId: body.user.id,
    accessToken: body.accessToken,
    device: await createDevice(body.tenant.id),
  };
}

const report = (tenantId: string): Promise<IntegrityReport> =>
  withTenant(appDb().db, tenantId, (tx) => checkIntegrity(tx, tenantId));

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    const [row] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from ${ownerDb()(table)}`;
    out[table] = row!.n;
  }
  return out;
}

/** A till's day: its shift, PER_TILL sales of every kind, a few drawer movements, a close. */
function tillDay(
  store: Store,
  device: TestDevice,
  products: { productId: string; variantId: string; name: string }[],
  till: number,
): SyncDocument[] {
  const doc = documents(device);
  const open = doc(
    'shift_open',
    shiftOpen(store.userId, [
      { currency: 'SYP', amountMinor: 500_000 },
      { currency: 'USD', amountMinor: 10_000 },
    ]),
  );
  const docs = [open];
  const syp: DrawerTerms = {
    currency: 'SYP',
    opening: 500_000,
    cashIn: 0,
    changeOut: 0,
    payIn: 0,
    payOut: 0,
    counted: 0,
  };
  const usd: DrawerTerms = {
    currency: 'USD',
    opening: 10_000,
    cashIn: 0,
    changeOut: 0,
    payIn: 0,
    payOut: 0,
    counted: 0,
  };
  for (let i = 0; i < PER_TILL; i++) {
    const k = i + till * 7;
    const p = k % PRICES.length;
    const qty = 1 + (k % 3);
    const discountBp = k % 5 === 0 ? 1_000 : null;
    const lines = [
      cartLine(1, PRICES[p]!, {
        ...products[p]!,
        qty: qty * 1000,
        discount:
          discountBp === null
            ? null
            : { type: 'percent', bp: discountBp, source: 'manual', reason: null, approval: null },
      }),
    ];
    const due = PRICES[p]! * qty - (discountBp ? Math.round((PRICES[p]! * qty * discountBp) / 10_000) : 0);
    const way = k % 4;
    let payload;
    try {
      if (way === 0) {
        payload = sale(store, open.id, {
          lines,
          payments: [{ method: 'cash', currency: 'SYP', amountMinor: due + 1_000 }],
          cashSteps: { SYP: 1000, USD: 25 },
        });
      } else if (way === 1) {
        payload = sale(store, open.id, {
          lines,
          payments: [{ method: 'card', currency: 'SYP', amountMinor: due, reference: `C${k}` }],
        });
      } else if (way === 2) {
        payload = sale(store, open.id, {
          lines,
          payments: [{ method: 'wallet', currency: 'SYP', amountMinor: due, reference: `W${k}` }],
        });
      } else {
        payload = sale(store, open.id, {
          lines,
          payments: [{ method: 'cash', currency: 'USD', amountMinor: Math.ceil(due / 130) + 100 }],
          changeCurrency: 'USD',
          cashSteps: { SYP: 1000, USD: 25 },
        });
      }
    } catch (error) {
      throw new Error(`sale ${k} of till ${till} could not be built: ${(error as Error).message}`);
    }
    for (const t of payload.payments) {
      if (t.method === 'cash') (t.currency === 'USD' ? usd : syp).cashIn! += t.amountMinor;
    }
    if (payload.change)
      (payload.change.currency === 'USD' ? usd : syp).changeOut! += payload.change.amountMinor;
    docs.push(doc('sale', payload));
  }
  docs.push(doc('cash_movement', movement(store.userId, open.id, 'pay_in', 20_000)));
  syp.payIn! += 20_000;
  docs.push(doc('cash_movement', movement(store.userId, open.id, 'expense', 7_500)));
  syp.payOut! += 7_500;
  const expected = (t: DrawerTerms) => t.opening! + t.cashIn! - t.changeOut! + t.payIn! - t.payOut!;
  docs.push(
    doc(
      'shift_close',
      shiftClose(
        store.userId,
        open.id,
        [
          { ...syp, counted: expected(syp) + (till % 2 === 0 ? -1_500 : 2_000) },
          { ...usd, counted: expected(usd) - (till === 3 ? 100 : 0) },
        ],
        { shiftNumber: open.number! },
      ),
    ),
  );
  return docs;
}

describe('upgrade from the previous schema (N−1 → N)', () => {
  it(`keeps the books of ${INVOICES} invoices exactly as they were`, async () => {
    const started = Date.now();
    const previous = previousMigrations();
    previousFolder = previous.folder;
    const appliedAtPrevious = await rebuildAt(previous.folder);
    expect(appliedAtPrevious).toHaveLength(readMigrations().length - 1);
    expect(appliedAtPrevious).not.toContain(previous.last);

    // A store at N−1, as a shop's server would hold it: plans seeded, four tills, stock.
    await ownerDb()`insert into plans (code, name, sort_order, limits, features)
      values ('basic', 'الأساسية', 1, '{}', '{}') on conflict do nothing`;
    // The previous version writes the day, as the shop's server did before the update.
    previousServer = await startPreviousServer(previousCommit(previous.last), {
      DATABASE_URL: TEST_APP_URL,
      JWT_SECRET: 'test-secret-that-is-definitely-long-enough-123',
    });
    const old = previousServer.app;
    const store = await openStoreOn(old, '0955555555');
    const tills = [store.device];
    for (let i = 1; i < TILLS; i++) tills.push(await createDevice(store.tenantId));
    const products = [];
    for (const [i, price] of PRICES.entries())
      products.push(await makeProduct(old, store, `صنف ${i}`, price));
    for (const p of products) {
      await ownerDb()`insert into stock_levels (tenant_id, branch_id, variant_id, qty)
        values (${store.tenantId}, ${store.device.branchId}, ${p.variantId}, 100000000)`;
      await ownerDb()`insert into stock_movements (tenant_id, branch_id, variant_id, qty, kind, doc_id, line_no, business_date)
        values (${store.tenantId}, ${store.device.branchId}, ${p.variantId}, 100000000, 'opening', gen_random_uuid(), 1, '2026-10-30')`;
    }
    for (const [t, device] of tills.entries()) {
      const docs = tillDay(store, device, products, t);
      for (let i = 0; i < docs.length; i += BATCH) {
        const res = await push(old, device, docs.slice(i, i + BATCH));
        const refused = res.results.filter((r) => r.status === 'rejected' || r.status === 'quarantined');
        expect(refused, JSON.stringify(refused.slice(0, 3))).toEqual([]);
      }
    }
    const filled = Date.now();

    const before = await report(store.tenantId);
    expect(before.checks.flatMap((c) => c.problems)).toEqual([]);
    const rowsBefore = await counts();
    expect(rowsBefore.invoices).toBe(INVOICES);
    expect(rowsBefore.journal_entries).toBeGreaterThan(INVOICES);

    // The upgrade itself: the old server stops, the migration runs, the new server starts.
    await previousServer.stop();
    previousServer = undefined;
    const applied = await runMigrations(TEST_OWNER_URL);
    expect(applied).toEqual([previous.last]);
    const upgraded = Date.now();

    const after = await report(store.tenantId);
    expect(after.checks.flatMap((c) => c.problems)).toEqual([]);
    expect(after.ok).toBe(true);
    expect(after.ledger).toEqual(before.ledger);
    expect(after.stock).toEqual(before.stock);
    expect(await counts()).toEqual(rowsBefore);

    // The upgraded server still takes a sale, and its books stay whole.
    app = await makeApp();
    const till = await createDevice(store.tenantId);
    const doc = documents(till, '2026-10-31');
    const open = doc('shift_open', shiftOpen(store.userId));
    const next = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, PRICES[0]!, { ...products[0]!, qty: 1000 })],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: PRICES[0]! }],
      }),
    );
    const res = await push(app, till, [open, next]);
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'accepted']);
    const later = await report(store.tenantId);
    expect(later.ok).toBe(true);
    expect(later.ledger.rows).toBe(after.ledger.rows + 1);

    console.log(
      `upgrade N−1 → N (${previous.last}): ${INVOICES} invoices, ${rowsBefore.journal_entries} entries; ` +
        `filled in ${((filled - started) / 1000).toFixed(1)} s, migrated in ${((upgraded - filled) / 1000).toFixed(1)} s`,
    );
  });
});
