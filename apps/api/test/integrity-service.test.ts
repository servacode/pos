import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { withTenant } from '@serva/db';
import type { SyncDocument } from '@serva/sync';
import { checkIntegrity, INTEGRITY_CHECKS, type IntegrityReport } from '../src/services/integrity';
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
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { TEST_OWNER_URL } from './urls';

/**
 * Task M0-5: services/integrity.ts finds what is wrong and only that. A clean day passes; then
 * each check is shown to catch the one tampering it exists for, done straight in the database as
 * a bug or a hand edit would (the append-only triggers are lifted for the test, as only the
 * table owner can). A tampering that keeps every entry balanced is caught too: a balanced ledger
 * with wrong numbers in it is exactly what these reconciliations are for (architecture review,
 * question 8). The fingerprint ignores ids, entry numbers and row order, and nothing else.
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
const problems = (r: IntegrityReport, name: string) => r.checks.find((c) => c.name === name)!.problems;
const failing = (r: IntegrityReport) => r.checks.filter((c) => !c.ok).map((c) => c.name);

/** Runs `statements` as the table owner with the append-only guard of the journal lifted. */
async function tamper(statements: (sql: ReturnType<typeof ownerDb>) => Promise<unknown>) {
  await ownerDb().begin(async (sql) => {
    await sql`alter table journal_entries disable trigger append_only`;
    await sql`alter table journal_lines disable trigger append_only`;
    await statements(sql as unknown as ReturnType<typeof ownerDb>);
    // The deferred "every entry has lines" check runs now, before the guard comes back.
    await sql`set constraints all immediate`;
    await sql`alter table journal_entries enable trigger append_only`;
    await sql`alter table journal_lines enable trigger append_only`;
  });
}

const lineOf = (tenantId: string, sourceId: string, code: string) => ownerDb()`
  select l.id from journal_lines l
  join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
  join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
  where l.tenant_id = ${tenantId} and e.source_id = ${sourceId} and a.code = ${code}`;

interface Day {
  store: Store;
  open: SyncDocument;
  cashSale: SyncDocument;
  cardSale: SyncDocument;
}

/** A shift: a cash sale, a card-and-cash sale, an expense, a close 500 short. */
async function day(phone: string): Promise<Day> {
  const store = await openStore(app, phone);
  const products = [
    await makeProduct(app, store, 'رز', 125_000),
    await makeProduct(app, store, 'سكر', 37_500),
  ];
  for (const p of products) {
    await ownerDb()`insert into stock_levels (tenant_id, branch_id, variant_id, qty)
      values (${store.tenantId}, ${store.device.branchId}, ${p.variantId}, 50000)`;
    await ownerDb()`insert into stock_movements (tenant_id, branch_id, variant_id, qty, kind, doc_id, line_no, business_date)
      values (${store.tenantId}, ${store.device.branchId}, ${p.variantId}, 50000, 'opening', gen_random_uuid(), 1, '2026-10-30')`;
  }
  const doc = documents(store.device);
  const open = doc(
    'shift_open',
    shiftOpen(store.userId, [
      { currency: 'SYP', amountMinor: 200_000 },
      { currency: 'USD', amountMinor: 5_000 },
    ]),
  );
  const cashSale = doc(
    'sale',
    sale(store, open.id, {
      lines: [cartLine(1, 125_000, { ...products[0]!, qty: 2000 })],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 250_000 }],
    }),
  );
  const cardSale = doc(
    'sale',
    sale(store, open.id, {
      lines: [cartLine(1, 37_500, { ...products[1]!, qty: 1000 })],
      payments: [
        { method: 'card', currency: 'SYP', amountMinor: 20_000, reference: 'C1' },
        { method: 'cash', currency: 'SYP', amountMinor: 17_500 },
      ],
    }),
  );
  const expense = doc('cash_movement', movement(store.userId, open.id, 'expense', 3_000));
  const close = doc(
    'shift_close',
    shiftClose(
      store.userId,
      open.id,
      [
        {
          currency: 'SYP',
          opening: 200_000,
          cashIn: 267_500,
          payOut: 3_000,
          counted: 200_000 + 267_500 - 3_000 - 500,
        },
        { currency: 'USD', opening: 5_000, counted: 5_000 },
      ],
      { shiftNumber: open.number! },
    ),
  );
  await push(app, store.device, [open, cashSale, cardSale, expense, close]);
  return { store, open, cashSale, cardSale };
}

let d: Day;
beforeEach(async () => {
  await resetDatabase();
  d = await day('0933333333');
});

describe('a clean day', () => {
  it('passes every check, and fingerprints the four entries', async () => {
    const r = await report(d.store.tenantId);
    expect(r.checks.map((c) => c.name)).toEqual(INTEGRITY_CHECKS);
    expect(r.checks.flatMap((c) => c.problems)).toEqual([]);
    expect(r.ok).toBe(true);
    // Two sales, the expense, and the shortage of the close.
    expect(r.ledger.rows).toBe(4);
    expect(r.ledger.hash).toMatch(/^[0-9a-f]{64}$/);
    // Two levels and two opening movements, and one sale movement each.
    expect(r.stock.rows).toBe(6);
    expect(r.stock.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.stock.hash).not.toBe(r.ledger.hash);
  });

  it('gives the same fingerprints every time, and another store changes none of them', async () => {
    const first = await report(d.store.tenantId);
    await day('0944444444');
    const again = await report(d.store.tenantId);
    expect(again.ledger).toEqual(first.ledger);
    expect(again.stock).toEqual(first.stock);
  });
});

describe('the fingerprint is about the books, not about how they were stored', () => {
  it('keeps its value when every entry gets a new id, a new number and a new place on disk', async () => {
    const before = await report(d.store.tenantId);
    const tenantId = d.store.tenantId;
    await tamper(async (sql) => {
      // Copy every entry under a new id and number (its source parked on the new id while both
      // exist), move its lines over, drop the old one…
      await sql`create temp table moved on commit drop as
        select id as old_id, gen_random_uuid() as new_id, source_id from journal_entries where tenant_id = ${tenantId}`;
      await sql`insert into journal_entries (id, tenant_id, branch_id, year, seq, number, entry_date, posting_date,
          kind, source_type, source_id, source_number, memo, base_currency, total_minor, reverses_id, created_by)
        select m.new_id, e.tenant_id, e.branch_id, e.year, e.seq + 1000,
          e.year || '-' || lpad((e.seq + 1000)::text, 7, '0'), e.entry_date, e.posting_date,
          e.kind, e.source_type, m.new_id, e.source_number, 'نص آخر', e.base_currency, e.total_minor,
          e.reverses_id, e.created_by
        from journal_entries e join moved m on m.old_id = e.id where e.tenant_id = ${tenantId}`;
      await sql`update journal_lines l set entry_id = m.new_id, memo = 'نص آخر'
        from moved m where l.tenant_id = ${tenantId} and l.entry_id = m.old_id`;
      await sql`delete from journal_entries e using moved m where e.tenant_id = ${tenantId} and e.id = m.old_id`;
      await sql`update journal_entries e set source_id = m.source_id from moved m
        where e.tenant_id = ${tenantId} and e.id = m.new_id`;
      // …then number them backwards: the last to arrive is now 1.
      await sql`update journal_entries set seq = 3005 - seq,
          number = year || '-' || lpad((3005 - seq)::text, 7, '0') where tenant_id = ${tenantId}`;
      await sql`update journal_entries set seq = seq - 2000,
          number = year || '-' || lpad((seq - 2000)::text, 7, '0')
        where tenant_id = ${tenantId}`;
    });
    const numbers = await ownerDb()<{ seq: number }[]>`
      select seq from journal_entries where tenant_id = ${tenantId} order by seq`;
    expect(numbers.map((n) => n.seq)).toEqual([1, 2, 3, 4]);

    const after = await report(tenantId);
    expect(after.ok).toBe(true);
    expect(after.ledger).toEqual(before.ledger);
  });
});

describe('each check catches what it is for', () => {
  it('an entry that no longer balances (entries_balanced)', async () => {
    const before = await report(d.store.tenantId);
    const [line] = await lineOf(d.store.tenantId, d.cashSale.id, '4100');
    await tamper(
      (sql) => sql`update journal_lines set credit_minor = credit_minor - 100 where id = ${line!.id}`,
    );
    const r = await report(d.store.tenantId);
    expect(problems(r, 'entries_balanced')).toHaveLength(1);
    expect(problems(r, 'entries_balanced')[0]).toMatch(/^القيد \d{4}-\d{7}: مدين 250000، دائن 249900/);
    expect(r.ok).toBe(false);
    expect(r.ledger.hash).not.toBe(before.ledger.hash);
    expect(r.stock).toEqual(before.stock);
  });

  it('a balanced entry that moved sales into rounding: balanced, and still wrong (day_report_ledger)', async () => {
    const [sales] = await lineOf(d.store.tenantId, d.cashSale.id, '4100');
    const [rounding] = await ownerDb()<{ id: string }[]>`
      select id from accounts where tenant_id = ${d.store.tenantId} and code = '6400'`;
    await tamper((sql) => sql`update journal_lines set account_id = ${rounding!.id} where id = ${sales!.id}`);
    const r = await report(d.store.tenantId);
    expect(failing(r)).toEqual(['day_report_ledger']);
    expect(problems(r, 'day_report_ledger')).toEqual([
      expect.stringMatching(/يوم 2026-10-30، صافي المبيعات: تقرير اليوم 287500 والدفتر 37500$/),
      expect.stringMatching(/يوم 2026-10-30، تقريب النقد: تقرير اليوم 0 والدفتر 250000$/),
    ]);
  });

  it('cash booked as card: the drawer and the day report both disagree (drawer_ledger, day_report_ledger)', async () => {
    const [drawer] = await ownerDb()<{ id: string }[]>`
      select l.id from journal_lines l
      join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where l.tenant_id = ${d.store.tenantId} and e.source_id = ${d.cashSale.id} and a.parent_code = '1110'`;
    const [card] = await ownerDb()<{ id: string }[]>`
      select id from accounts where tenant_id = ${d.store.tenantId} and code = '1140'`;
    await tamper(
      (sql) =>
        sql`update journal_lines set account_id = ${card!.id}, shift_id = null where id = ${drawer!.id}`,
    );
    const r = await report(d.store.tenantId);
    expect(failing(r)).toEqual(['drawer_ledger', 'day_report_ledger']);
    expect(problems(r, 'drawer_ledger')).toEqual([
      `الوردية ${d.open.number} (SYP): حركة الدرج حسب المستندات 264500 وحسب الدفتر 14500`,
    ]);
    expect(problems(r, 'day_report_ledger')).toEqual([
      expect.stringMatching(/البطاقة: تقرير اليوم 20000 والدفتر 270000$/),
      expect.stringMatching(/النقد: تقرير اليوم 267500 والدفتر 17500$/),
    ]);
  });

  it('a counted amount changed after the close (drawer_ledger, the server-side difference)', async () => {
    await ownerDb()`update shifts set closing = jsonb_set(closing, '{cash,0,countedMinor}',
        to_jsonb((closing #>> '{cash,0,countedMinor}')::bigint + 100))
      where tenant_id = ${d.store.tenantId} and id = ${d.open.id}`;
    const r = await report(d.store.tenantId);
    expect(failing(r)).toEqual(['drawer_ledger']);
    expect(problems(r, 'drawer_ledger')).toEqual([
      `الوردية ${d.open.number} (SYP): فرق الإغلاق حسب الخادم (المعدود ناقص المتوقع) -400 والمرحّل -500`,
    ]);
  });

  it('stock that no longer equals its movements (stock_movements)', async () => {
    const before = await report(d.store.tenantId);
    const [level] = await ownerDb()<{ id: string; variant_id: string }[]>`
      select id, variant_id from stock_levels where tenant_id = ${d.store.tenantId} order by variant_id limit 1`;
    await ownerDb()`update stock_levels set qty = qty + 1000 where id = ${level!.id}`;
    const r = await report(d.store.tenantId);
    expect(failing(r)).toEqual(['stock_movements']);
    expect(problems(r, 'stock_movements')).toHaveLength(1);
    expect(problems(r, 'stock_movements')[0]).toContain(`الصنف ${level!.variant_id}`);
    expect(r.stock.hash).not.toBe(before.stock.hash);
    expect(r.ledger).toEqual(before.ledger);
  });

  it('a gap in the entry numbers (journal_numbering)', async () => {
    await tamper(
      (
        sql,
      ) => sql`update journal_entries set seq = seq + 1, number = year || '-' || lpad((seq + 1)::text, 7, '0')
        where tenant_id = ${d.store.tenantId} and seq = (select max(seq) from journal_entries where tenant_id = ${d.store.tenantId})`,
    );
    const r = await report(d.store.tenantId);
    expect(failing(r)).toEqual(['journal_numbering']);
    expect(problems(r, 'journal_numbering')).toEqual(['سنة 2026: لا قيد بالأرقام من 4 إلى 4']);
  });
});

describe('the command line tool', () => {
  const run = async (...args: string[]) => {
    try {
      const { stdout } = await promisify(execFile)(
        'pnpm',
        ['exec', 'tsx', 'src/scripts/integrity.ts', ...args],
        {
          cwd: resolve(__dirname, '..'),
          env: { ...process.env, DATABASE_MIGRATION_URL: TEST_OWNER_URL },
        },
      );
      return { code: 0, stdout };
    } catch (error) {
      const e = error as { code: number; stdout: string };
      return { code: e.code, stdout: e.stdout };
    }
  };

  it('exits 0 on clean books with the same fingerprints, and 1 once a store has a problem', async () => {
    const [store] = await ownerDb()<{ code: string }[]>`
      select store_code as code from tenants where id = ${d.store.tenantId}`;
    const expected = await report(d.store.tenantId);

    const clean = await run('--json', `--store=${store!.code}`);
    expect(clean.code).toBe(0);
    const parsed = JSON.parse(clean.stdout) as { ok: boolean; stores: IntegrityReport[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.stores[0]!.ledger).toEqual(expected.ledger);
    expect(parsed.stores[0]!.stock).toEqual(expected.stock);

    await ownerDb()`update stock_levels set qty = qty - 1 where tenant_id = ${d.store.tenantId}`;
    const broken = await run();
    expect(broken.code).toBe(1);
    expect(broken.stdout).toContain(`✘ المتجر ${store!.code}`);
    expect(broken.stdout).toContain('✘ المخزون = مجموع حركاته');
    expect(broken.stdout).toContain('لم يُصحَّح شيء');
  }, 60_000);
});
