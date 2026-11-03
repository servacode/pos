import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { withTenant } from '@serva/db';
import { checkIntegrity, type IntegrityReport } from '../src/services/integrity';
import {
  cartLine,
  documents,
  makeProduct,
  openStore,
  push,
  sale,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { activateDevice, firstBranch, type TestDevice } from './devices';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/**
 * Task M0-8: after a restore, no number means two things. restore_counters_jump() (migration
 * 0014, called by scripts/local/restore.sh) moves entry numbers and device codes past a margin and
 * records the skipped ranges; the next entry and the next till take numbers nothing could have
 * used before, and the integrity check accepts the recorded range and nothing else.
 */

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});

const report = (tenantId: string): Promise<IntegrityReport> =>
  withTenant(appDb().db, tenantId, (tx) => checkIntegrity(tx, tenantId));
const numbering = async (tenantId: string) =>
  (await report(tenantId)).checks.find((c) => c.name === 'journal_numbering')!.problems;

const entryNumbers = async (tenantId: string) =>
  (
    await ownerDb()<{ number: string }[]>`
      select number from journal_entries where tenant_id = ${tenantId} order by year, seq`
  ).map((r) => r.number);

const jumps = (tenantId: string) => ownerDb()<
  { counter: string; year: number | null; from_number: number; to_number: number; reason: string }[]
>`select counter, year, from_number, to_number, reason from counter_jumps
  where tenant_id = ${tenantId} order by counter, from_number`;

let store: Store;
let product: Awaited<ReturnType<typeof makeProduct>>;
let till: TestDevice;
let doc: ReturnType<typeof documents>;
let shiftId: string;

/** One cash sale from the till: one entry. */
async function sell() {
  const res = await push(app, till, [
    doc(
      'sale',
      sale(store, shiftId, {
        lines: [cartLine(1, 125_000, { ...product, qty: 1000 })],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 125_000 }],
      }),
    ),
  ]);
  expect(res.results[0]!.status).toBe('accepted');
}

beforeEach(async () => {
  await resetDatabase();
  store = await openStore(app, '0966666666');
  product = await makeProduct(app, store, 'رز', 125_000);
  till = await activateDevice(app, store.accessToken, await firstBranch(store.tenantId), 'كاشير 1');
  doc = documents(till);
  const open = doc('shift_open', shiftOpen(store.userId));
  shiftId = open.id;
  await push(app, till, [open]);
  for (let i = 0; i < 3; i++) await sell();
});

describe('restore_counters_jump()', () => {
  it('moves entry numbers past the margin: the next entry is 104, and the books stay whole', async () => {
    expect(await entryNumbers(store.tenantId)).toEqual(['2026-0000001', '2026-0000002', '2026-0000003']);
    const [answer] = await ownerDb()<{ stores: number }[]>`select restore_counters_jump(100, 5) as stores`;
    expect(answer!.stores).toBe(1);

    await sell();
    expect((await entryNumbers(store.tenantId)).at(-1)).toBe('2026-0000104');
    expect(await jumps(store.tenantId)).toEqual([
      // The store's only branch held codes 002 (the test device) and 003 (the till linked here).
      { counter: 'device_code', year: null, from_number: 4, to_number: 8, reason: 'restore' },
      { counter: 'journal', year: 2026, from_number: 4, to_number: 103, reason: 'restore' },
    ]);
    const r = await report(store.tenantId);
    expect(r.checks.flatMap((c) => c.problems)).toEqual([]);
  });

  it('gives the next till a code past every code a forgotten till may hold', async () => {
    await ownerDb()`select restore_counters_jump(100, 5)`;
    const next = await activateDevice(app, store.accessToken, await firstBranch(store.tenantId), 'كاشير 2');
    expect(till.code).toBe('003');
    expect(next.code).toBe('009');
  });

  it('jumps again when run again, and still reads as declared', async () => {
    await ownerDb()`select restore_counters_jump(100, 5)`;
    await ownerDb()`select restore_counters_jump(50, 5)`;
    await sell();
    expect((await entryNumbers(store.tenantId)).at(-1)).toBe('2026-0000154');
    expect(await numbering(store.tenantId)).toEqual([]);
    expect((await jumps(store.tenantId)).filter((j) => j.counter === 'device_code')).toEqual([
      { counter: 'device_code', year: null, from_number: 4, to_number: 8, reason: 'restore' },
      { counter: 'device_code', year: null, from_number: 9, to_number: 13, reason: 'restore' },
    ]);
  });

  it('covers the current year of a store that has numbered nothing yet', async () => {
    const other = await openStore(app, '0977777777');
    await ownerDb()`select restore_counters_jump(100, 5)`;
    const year = new Date().getUTCFullYear();
    expect((await jumps(other.tenantId)).filter((j) => j.counter === 'journal')).toEqual([
      { counter: 'journal', year, from_number: 1, to_number: 100, reason: 'restore' },
    ]);
    expect(await numbering(other.tenantId)).toEqual([]);
  });

  it('refuses margins below one, and the store role cannot call it', async () => {
    await expect(ownerDb()`select restore_counters_jump(0, 5)`).rejects.toThrow(/margins must be positive/);
    await expect(
      withTenant(appDb().db, store.tenantId, (tx) => tx.execute('select restore_counters_jump()' as never)),
    ).rejects.toThrow();
  });

  it('keeps its record: a recorded jump cannot be changed or removed', async () => {
    await ownerDb()`select restore_counters_jump(100, 5)`;
    await expect(
      ownerDb()`update counter_jumps set to_number = 3 where tenant_id = ${store.tenantId}`,
    ).rejects.toThrow();
    await expect(ownerDb()`delete from counter_jumps where tenant_id = ${store.tenantId}`).rejects.toThrow();
  });
});

describe('the integrity check still catches what a jump does not explain', () => {
  it('an undeclared gap, and an entry numbered inside a jump', async () => {
    await ownerDb()`select restore_counters_jump(100, 5)`;
    await sell(); // 104
    await ownerDb().begin(async (sql) => {
      await sql`alter table journal_entries disable trigger append_only`;
      // Entry 104 moves to 106: 104 and 105 are a gap nobody declared.
      await sql`update journal_entries set seq = 106, number = '2026-0000106'
        where tenant_id = ${store.tenantId} and seq = 104`;
      // Entry 3 moves to 50: inside the jump, and 3 is left empty.
      await sql`update journal_entries set seq = 50, number = '2026-0000050'
        where tenant_id = ${store.tenantId} and seq = 3`;
      await sql`alter table journal_entries enable trigger append_only`;
    });
    expect(await numbering(store.tenantId)).toEqual([
      'سنة 2026: لا قيد بالأرقام من 3 إلى 3',
      'سنة 2026: الأرقام من 50 إلى 50 مستعملة مرتين (قيد وقفزة استعادة، أو قيدان)',
      'سنة 2026: لا قيد بالأرقام من 104 إلى 105',
    ]);
  });
});
