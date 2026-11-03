import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDb } from '@serva/db';
import { DOCUMENT_PROCESSORS } from '../src/services/processors';
import { checkRebuild } from '../src/services/rebuild';
import {
  cartLine,
  documents,
  makeProduct,
  movement,
  openStore,
  push,
  sale,
  shiftClose,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { TEST_OWNER_URL } from './urls';

/**
 * Task M1-7: the books are a function of the stored documents. A rebuild replays them, in the
 * canonical order, on books cleared of their effects, compares fingerprints, and changes nothing.
 */

let app: FastifyInstance;
const owner = createDb(TEST_OWNER_URL, { max: 1 });
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await owner.client.end();
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});

const NOW = new Date('2026-10-30T12:00:00.000Z');
const rebuild = (tenantId: string) =>
  checkRebuild(owner.db, { tenantId, processors: DOCUMENT_PROCESSORS, now: NOW });

const counts = async (tenantId: string) => {
  const out: Record<string, number> = {};
  for (const t of [
    'invoices',
    'invoice_lines',
    'invoice_payments',
    'cash_movements',
    'shifts',
    'stock_movements',
    'journal_entries',
    'journal_lines',
  ]) {
    const [row] = await ownerDb()<
      { n: number }[]
    >`select count(*)::int as n from ${ownerDb()(t)} where tenant_id = ${tenantId}`;
    out[t] = row!.n;
  }
  const [levels] = await ownerDb()<
    { q: string }[]
  >`select coalesce(sum(qty), 0)::text as q from stock_levels where tenant_id = ${tenantId}`;
  out.stock = Number(levels!.q);
  return out;
};

let store: Store;
beforeEach(async () => {
  await resetDatabase();
  store = await openStore(app, '0914141414');
  const p = await makeProduct(app, store, 'رز', 125_000);
  // Opening stock that no document made: a rebuild must leave it
  await ownerDb()`insert into stock_levels (tenant_id, branch_id, variant_id, qty)
    values (${store.tenantId}, ${store.device.branchId}, ${p.variantId}, 50000)`;
  await ownerDb()`insert into stock_movements (tenant_id, branch_id, variant_id, qty, kind, doc_id, line_no, business_date)
    values (${store.tenantId}, ${store.device.branchId}, ${p.variantId}, 50000, 'opening', gen_random_uuid(), 1, '2026-10-30')`;
  const doc = documents(store.device);
  const open = doc('shift_open', shiftOpen(store.userId));
  const s1 = doc(
    'sale',
    sale(store, open.id, {
      lines: [cartLine(1, 125_000, { ...p, qty: 2000 })],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 250_000 }],
    }),
  );
  const s2 = doc(
    'sale',
    sale(store, open.id, {
      lines: [cartLine(1, 125_000, { ...p, qty: 1000 })],
      payments: [{ method: 'card', currency: 'SYP', amountMinor: 125_000, reference: 'C1' }],
    }),
  );
  const m = doc('cash_movement', movement(store.userId, open.id, 'expense', 3_000));
  const close = doc(
    'shift_close',
    shiftClose(
      store.userId,
      open.id,
      [{ currency: 'SYP', opening: 100_000, cashIn: 250_000, payOut: 3_000, counted: 346_500 }],
      { shiftNumber: open.number! },
    ),
  );
  // Arrival order: everything backwards
  for (const d of [close, m, s2, s1, open]) await push(app, store.device, [d]);
});

describe('deterministic rebuild', () => {
  it('rebuilds the same books from the documents, and passes the integrity check', async () => {
    const r = await rebuild(store.tenantId);
    expect(r.failed).toEqual([]);
    expect(r.replayed).toBe(5);
    expect(r.rebuiltOk).toBe(true);
    expect(r.rebuilt).toEqual(r.live);
    expect(r.same).toBe(true);
    expect(r.live.ledger.rows).toBe(4);
  });

  it('changes nothing: every row and every guard is as it was', async () => {
    const before = await counts(store.tenantId);
    await rebuild(store.tenantId);
    expect(await counts(store.tenantId)).toEqual(before);
    // The append-only guard is back, and row-level security is not forced on the owner any more
    await expect(ownerDb()`delete from journal_lines where tenant_id = ${store.tenantId}`).rejects.toThrow();
    const [forced] = await ownerDb()<
      { n: number }[]
    >`select count(*)::int as n from pg_class where relforcerowsecurity`;
    expect(forced!.n).toBe(0);
  });

  it('finds books edited by hand: they are not what the documents say', async () => {
    await ownerDb().begin(async (sql) => {
      await sql`alter table journal_lines disable trigger append_only`;
      await sql`update journal_lines set debit_minor = debit_minor + 500, credit_minor = credit_minor
        where tenant_id = ${store.tenantId} and debit_minor > 0
          and id = (select id from journal_lines where tenant_id = ${store.tenantId} and debit_minor > 0 limit 1)`;
      await sql`update journal_lines set credit_minor = credit_minor + 500
        where tenant_id = ${store.tenantId}
          and id = (select id from journal_lines where tenant_id = ${store.tenantId} and credit_minor > 0 limit 1)`;
      await sql`alter table journal_lines enable trigger append_only`;
    });
    const r = await rebuild(store.tenantId);
    expect(r.failed).toEqual([]);
    expect(r.rebuilt.ledger.hash).not.toBe(r.live.ledger.hash);
    expect(r.same).toBe(false);
  });

  it('finds stock moved by hand', async () => {
    await ownerDb()`update stock_levels set qty = qty - 1000 where tenant_id = ${store.tenantId}`;
    const r = await rebuild(store.tenantId);
    expect(r.rebuilt.stock.hash).not.toBe(r.live.stock.hash);
    expect(r.same).toBe(false);
  });

  it('rebuilds one store only', async () => {
    const other = await openStore(app, '0915151515');
    const d = documents(other.device);
    await push(app, other.device, [d('shift_open', shiftOpen(other.userId))]);
    const before = await counts(other.tenantId);
    const r = await rebuild(store.tenantId);
    expect(r.same).toBe(true);
    expect(await counts(other.tenantId)).toEqual(before);
  });
});
