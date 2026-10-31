import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { withTenant } from '@serva/db';
import {
  balances,
  cartLine,
  compact,
  documents,
  goldenFirstSale,
  movement,
  newId,
  openStore,
  postedEntries,
  push,
  sale,
  shiftClose,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { createDevice } from './devices';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

async function taxRate(store: Store, kind: 'sales' | 'consumption' | 'stamp', rateBp = 1500) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/tax-rates',
    headers: { authorization: `Bearer ${store.accessToken}` },
    payload: { name: `ضريبة ${kind}`, rateBp, kind },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>().id;
}

describe('the chart of accounts (10 › دليل الحسابات الافتراضي)', () => {
  it('gives every new store the 49 accounts of «كل متجر», the groups, and a drawer and a safe per currency', async () => {
    const store = await openStore(app);
    const rows = await ownerDb()<
      { code: string; parent_code: string | null; is_group: boolean; currency: string | null; type: string }[]
    >`select code, parent_code, is_group, currency, type from accounts where tenant_id = ${store.tenantId} order by code`;
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const fourDigits = rows.filter((r) => r.code.length === 4);
    expect(fourDigits).toHaveLength(49);
    // Two groups of tab 10 (6100, 6500), plus the drawers and the safe that now have sub-accounts.
    expect(fourDigits.filter((r) => r.is_group).map((r) => r.code)).toEqual(['1110', '1120', '6100', '6500']);
    expect(byCode.get('111001')).toMatchObject({ parent_code: '1110', currency: 'SYP', is_group: false });
    expect(byCode.get('111002')).toMatchObject({ parent_code: '1110', currency: 'USD', is_group: false });
    expect(byCode.get('112002')).toMatchObject({ parent_code: '1120', currency: 'USD' });
    // The parent is an explicit field: 2200-like accounts sit under 21, not under their prefix.
    expect(byCode.get('2300')?.parent_code).toBe('21');
    expect(byCode.get('6101')?.parent_code).toBe('6100');
    // Optional modules' accounts wait until they are needed.
    for (const code of ['1115', '1250', '2200', '2210', '2550', '4150']) expect(byCode.has(code)).toBe(false);
    // Every parent exists.
    for (const r of rows) if (r.parent_code) expect(byCode.has(r.parent_code), r.code).toBe(true);
  });

  it('marks contra accounts with the other normal side', async () => {
    const store = await openStore(app);
    const sides = await ownerDb()<{ code: string; normal_side: string; final_account: string }[]>`
      select code, normal_side, final_account from accounts
      where tenant_id = ${store.tenantId} and code in ('1290', '3160', '4200', '4300', '2100', '6200', '4100', '5100', '4920')
      order by code`;
    expect(sides.map((s) => [s.code, s.normal_side, s.final_account])).toEqual([
      ['1290', 'credit', 'balance_sheet'],
      ['2100', 'credit', 'balance_sheet'],
      ['3160', 'debit', 'balance_sheet'],
      ['4100', 'credit', 'trading'],
      ['4200', 'debit', 'trading'],
      ['4300', 'debit', 'trading'],
      ['4920', 'credit', 'profit_loss'],
      ['5100', 'debit', 'trading'],
      ['6200', 'debit', 'profit_loss'],
    ]);
  });
});

describe('sale entries (10 › القيود التلقائية)', () => {
  it('posts the golden first sale: two drawers at the payment’s rate, discount and sales gross', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc('sale', goldenFirstSale(store, open.id));
    await push(app, store.device, [open, sold]);
    const [entry, ...others] = await postedEntries(store.tenantId);
    expect(others).toEqual([]);
    expect(entry).toMatchObject({
      number: '2026-0000001',
      sourceType: 'sale',
      sourceId: sold.id,
      total: 135000,
    });
    // 1,350 shelf − 60 off the tea = 1,290: 9 $ at 130 (1,170.00) and 200 − 80 change (120.00).
    expect(entry!.lines).toEqual([
      { code: '111002', debit: 117000, credit: 0, currency: 'USD', amount: 900 },
      { code: '111001', debit: 12000, credit: 0, currency: 'SYP', amount: 12000 },
      { code: '4200', debit: 6000, credit: 0, currency: 'SYP', amount: 6000 },
      { code: '4100', debit: 0, credit: 135000, currency: 'SYP', amount: -135000 },
    ]);
  });

  it('posts the worked invoice of tab 10 with tax 15 % exclusive: 14.09 cash, 1.40 discounts, 13.65 sales, 1.84 tax', async () => {
    const store = await openStore(app);
    const vat = await taxRate(store, 'sales');
    const doc = documents(store.device);
    const payload = sale(store, newId(), {
      taxInclusive: false,
      lines: [
        cartLine(1, 125, { qty: 2000, taxRateId: vat, taxRateBp: 1500, name: 'حليب طازج' }),
        cartLine(2, 75, { qty: 3000, taxRateId: vat, taxRateBp: 1500, name: 'خبز عربي' }),
        cartLine(3, 890, {
          taxRateId: vat,
          taxRateBp: 1500,
          name: 'أرز بسمتي',
          discount: { type: 'amount', minor: 40, source: 'manual', reason: null, approval: null },
        }),
      ],
      invoiceDiscount: { type: 'amount', minor: 100, source: 'manual', reason: null, approval: null },
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 2000 }],
    });
    expect(payload.change?.amountMinor).toBe(591);
    await push(app, store.device, [doc('sale', payload)]);
    const [entry] = await postedEntries(store.tenantId);
    expect(compact(entry)).toEqual([
      ['111001', 1409, 0],
      ['4200', 140, 0],
      ['4100', 0, 1365],
      ['2200', 0, 184],
    ]);
    expect(entry!.total).toBe(1549);
  });

  it('posts an inclusive price by subtraction: cash 1,000 and discounts 130 against sales 1,000 and tax 130', async () => {
    const store = await openStore(app);
    const consumption = await taxRate(store, 'consumption');
    const doc = documents(store.device);
    const payload = sale(store, newId(), {
      lines: [
        // The example's numbers in minor units, as tab 10 rounds them.
        cartLine(1, 1150, {
          taxRateId: consumption,
          taxRateBp: 1500,
          discount: { type: 'amount', minor: 150, source: 'manual', reason: null, approval: null },
        }),
      ],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 1000 }],
    });
    await push(app, store.device, [doc('sale', payload)]);
    // A consumption-spending tax goes to 2210, made the first time it is used.
    expect(compact((await postedEntries(store.tenantId))[0])).toEqual([
      ['111001', 1000, 0],
      ['4200', 130, 0],
      ['4100', 0, 1000],
      ['2210', 0, 130],
    ]);
  });

  it('credits cash rounding to 6400: 12,347.50 paid 12,350 with a 10-pound step', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const payload = sale(store, newId(), {
      lines: [cartLine(1, 1234750)],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 1235000 }],
      cashSteps: { SYP: 1000 },
    });
    expect(payload.cashRounding?.roundingBaseMinor).toBe(250);
    await push(app, store.device, [doc('sale', payload)]);
    expect(compact((await postedEntries(store.tenantId))[0])).toEqual([
      ['111001', 1235000, 0],
      ['4100', 0, 1234750],
      ['6400', 0, 250],
    ]);
  });

  it('debits 6400 when the cash is rounded down', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const payload = sale(store, newId(), {
      lines: [cartLine(1, 1234400)],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 1234000 }],
      cashSteps: { SYP: 1000 },
    });
    await push(app, store.device, [doc('sale', payload)]);
    expect(compact((await postedEntries(store.tenantId))[0])).toEqual([
      ['111001', 1234000, 0],
      ['6400', 400, 0],
      ['4100', 0, 1234400],
    ]);
  });

  it('sends card, wallet and transfer to their clearing accounts, credit to the customer, tips to 2550', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const customerId = newId();
    const payload = sale(store, newId(), {
      lines: [cartLine(1, 400000)],
      customerId,
      customerName: 'أبو سمير',
      tipMinor: 10000,
      payments: [
        { method: 'card', currency: 'SYP', amountMinor: 100000, reference: '731205', cardLast4: '4821' },
        { method: 'wallet', currency: 'SYP', amountMinor: 100000, reference: 'SC-1' },
        { method: 'transfer', currency: 'SYP', amountMinor: 100000, reference: 'TR-9' },
        { method: 'credit', currency: 'SYP', amountMinor: 110000 },
      ],
    });
    await push(app, store.device, [doc('sale', payload)]);
    const [entry] = await postedEntries(store.tenantId);
    expect(compact(entry)).toEqual([
      ['1140', 100000, 0],
      ['1150', 100000, 0],
      ['1130', 100000, 0],
      ['1200', 110000, 0],
      ['4100', 0, 400000],
      ['2550', 0, 10000],
    ]);
    const [party] = await ownerDb()<{ party_type: string; party_id: string; memo: string }[]>`
      select party_type, party_id, memo from journal_lines l join accounts a on a.id = l.account_id
      where l.tenant_id = ${store.tenantId} and a.code = '1200'`;
    expect(party).toEqual({ party_type: 'customer', party_id: customerId, memo: 'آجل' });
  });

  it('takes change in dollars out of the dollar drawer, valued at the sale’s rate', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    // 1,170 ل.س; 10 $ handed over (1,300) and 1 $ back (130): the dollar drawer gains 9 $.
    const payload = sale(store, newId(), {
      lines: [cartLine(1, 117000)],
      payments: [{ method: 'cash', currency: 'USD', amountMinor: 1000 }],
      changeCurrency: 'USD',
      cashSteps: { USD: 25 },
    });
    expect(payload.change).toMatchObject({ currency: 'USD', amountMinor: 100 });
    await push(app, store.device, [doc('sale', payload)]);
    const [entry] = await postedEntries(store.tenantId);
    expect(entry!.lines).toEqual([
      { code: '111002', debit: 117000, credit: 0, currency: 'USD', amount: 900 },
      { code: '4100', debit: 0, credit: 117000, currency: 'SYP', amount: -117000 },
    ]);
  });

  it('posts dollars taken at the collect rate at that rate, the difference to rounding', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const collect = { unit: 'USD', quote: 'SYP', rate: '128' } as const;
    const payload = sale(store, newId(), {
      lines: [cartLine(1, 129000)],
      payments: [
        { method: 'cash', currency: 'USD', amountMinor: 900, rate: collect },
        { method: 'cash', currency: 'SYP', amountMinor: 20000 },
      ],
      cashSteps: { SYP: 1000 },
    });
    await push(app, store.device, [doc('sale', payload)]);
    const [entry] = await postedEntries(store.tenantId);
    // 9 $ × 128 = 1,152; 138 still due, rounded to 140: 200 − 60 change; 2 ل.س gained.
    expect(compact(entry)).toEqual([
      ['111002', 115200, 0],
      ['111001', 14000, 0],
      ['4100', 0, 129000],
      ['6400', 0, 200],
    ]);
    const [rate] = await ownerDb()<{ rate: unknown }[]>`
      select rate from journal_lines where tenant_id = ${store.tenantId} and currency = 'USD'`;
    expect(rate!.rate).toEqual(collect);
  });

  it('posts no cost of sales: cost is not known in phase 1', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    await push(app, store.device, [doc('sale', goldenFirstSale(store, newId()))]);
    const codes = (await postedEntries(store.tenantId)).flatMap((e) => e.lines.map((l) => l.code));
    expect(codes).not.toContain('5100');
    expect(codes).not.toContain('1300');
  });

  it('keeps a device whose totals disagree with its lines balanced, the gap shown on sales', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const payload = sale(store, newId(), {
      lines: [cartLine(1, 50000)],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 50000 }],
    });
    payload.lines[0]!.priced.grossExTaxMinor = 49900;
    const res = await push(app, store.device, [doc('sale', payload)]);
    expect(res.results[0]).toMatchObject({ status: 'accepted', flags: ['totals_mismatch'] });
    expect(compact((await postedEntries(store.tenantId))[0])).toEqual([
      ['111001', 50000, 0],
      ['4100', 0, 49900],
      ['4100', 0, 100],
    ]);
  });

  it('posts nothing for a free sale with no payment', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const payload = sale(store, newId(), { lines: [cartLine(1, 0)], payments: [] });
    await push(app, store.device, [doc('sale', payload)]);
    expect(await postedEntries(store.tenantId)).toEqual([]);
  });
});

describe('cash movement entries', () => {
  it('pay-in from the safe, pay-out and drop to the safe, and an expense from the drawer', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const shiftId = newId();
    await push(app, store.device, [
      doc('cash_movement', movement(store.userId, shiftId, 'pay_in', 50000)),
      doc('cash_movement', movement(store.userId, shiftId, 'pay_out', 20000)),
      doc('cash_movement', movement(store.userId, shiftId, 'safe_drop', 30000)),
      doc('cash_movement', movement(store.userId, shiftId, 'expense', 15000)),
      doc('cash_movement', movement(store.userId, shiftId, 'pay_in', 500, { currency: 'USD' })),
    ]);
    const entries = await postedEntries(store.tenantId);
    expect(entries.map(compact)).toEqual([
      [
        ['111001', 50000, 0],
        ['112001', 0, 50000],
      ],
      [
        ['112001', 20000, 0],
        ['111001', 0, 20000],
      ],
      [
        ['112001', 30000, 0],
        ['111001', 0, 30000],
      ],
      [
        ['6102', 15000, 0],
        ['111001', 0, 15000],
      ],
      [
        ['111002', 65000, 0],
        ['112002', 0, 65000],
      ],
    ]);
    expect(entries.map((e) => e.sourceType)).toEqual(Array(5).fill('cash_movement'));
  });

  it('sends an expense number the chart lacks to 6190', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    await push(app, store.device, [
      doc('cash_movement', movement(store.userId, newId(), 'expense', 15000, { expenseAccountCode: '6111' })),
    ]);
    expect(compact((await postedEntries(store.tenantId))[0])).toEqual([
      ['6190', 15000, 0],
      ['111001', 0, 15000],
    ]);
  });
});

describe('shift close entries (10 › مطابقة الصندوق)', () => {
  it('a shortage to 6200, a dollar surplus at the close’s rate, nothing for an exact drawer', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const shiftId = newId();
    const close = shiftClose(store.userId, shiftId, [
      { currency: 'SYP', opening: 100000, cashIn: 50000, counted: 149500 },
      { currency: 'USD', opening: 2000, counted: 2100 },
    ]);
    await push(app, store.device, [doc('shift_close', close)]);
    const [entry] = await postedEntries(store.tenantId);
    expect(entry).toMatchObject({ sourceType: 'shift_close', sourceId: expect.any(String) });
    expect(entry!.lines).toEqual([
      { code: '6200', debit: 500, credit: 0, currency: 'SYP', amount: 500 },
      { code: '111002', debit: 13000, credit: 0, currency: 'USD', amount: 100 },
      { code: '111001', debit: 0, credit: 500, currency: 'SYP', amount: -500 },
      { code: '6200', debit: 0, credit: 13000, currency: 'SYP', amount: -13000 },
    ]);
  });

  it('charges a shortage to the cashier (1250) when the owner chose so', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const close = shiftClose(store.userId, newId(), [{ currency: 'SYP', opening: 100000, counted: 99000 }], {
      shortageTreatment: 'cashier_receivable',
      approval: { userId: store.userId, method: 'pin', at: '2026-10-30T20:00:00.000Z', offline: false },
    });
    await push(app, store.device, [doc('shift_close', close)]);
    expect(compact((await postedEntries(store.tenantId))[0])).toEqual([
      ['1250', 1000, 0],
      ['111001', 0, 1000],
    ]);
  });

  it('posts nothing when every drawer is exact, and only the first close of a shift', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const shiftId = newId();
    await push(app, store.device, [
      doc(
        'shift_close',
        shiftClose(store.userId, shiftId, [{ currency: 'SYP', opening: 100000, counted: 100000 }]),
      ),
      doc(
        'shift_close',
        shiftClose(store.userId, shiftId, [{ currency: 'SYP', opening: 100000, counted: 90000 }]),
      ),
    ]);
    expect(await postedEntries(store.tenantId)).toEqual([]);
  });
});

describe('numbering and replays', () => {
  it('numbers entries per year without gaps and posts a replayed document once', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sales = [1, 2, 3].map(() => doc('sale', goldenFirstSale(store, open.id)));
    await push(app, store.device, [open, ...sales]);
    await push(app, store.device, [open, ...sales]);
    // A second device's sale dated in the next year starts that year's numbers.
    const other = await createDevice(store.tenantId);
    await push(app, other, [documents(other, '2027-01-02')('sale', goldenFirstSale(store, newId()))]);
    const entries = await postedEntries(store.tenantId);
    expect(entries.map((e) => e.number)).toEqual([
      '2026-0000001',
      '2026-0000002',
      '2026-0000003',
      '2027-0000001',
    ]);
    expect(entries.map((e) => e.sourceId)).toEqual([...sales.map((s) => s.id), expect.any(String)]);
  });
});

describe('the ledger’s guarantees in the database', () => {
  async function postedIds(store: Store) {
    const doc = documents(store.device);
    await push(app, store.device, [doc('sale', goldenFirstSale(store, newId()))]);
    const [entry] = await ownerDb()<
      { id: string }[]
    >`select id from journal_entries where tenant_id = ${store.tenantId}`;
    const [cash] = await ownerDb()<{ id: string }[]>`
      select id from accounts where tenant_id = ${store.tenantId} and code = '111001'`;
    const [group] = await ownerDb()<{ id: string }[]>`
      select id from accounts where tenant_id = ${store.tenantId} and code = '6100'`;
    const [sales] = await ownerDb()<{ id: string }[]>`
      select id from accounts where tenant_id = ${store.tenantId} and code = '4100'`;
    return { entryId: entry!.id, cash: cash!.id, group: group!.id, sales: sales!.id };
  }

  /** Runs statements as the API's role in the store, and answers the database error code. */
  async function asStore(tenantId: string, statement: ReturnType<typeof sql>): Promise<string | undefined> {
    try {
      await withTenant(appDb().db, tenantId, (tx) => tx.execute(statement));
      return undefined;
    } catch (error) {
      for (let e: unknown = error; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
        const code = (e as { code?: unknown }).code;
        if (typeof code === 'string') return code;
      }
      throw error;
    }
  }

  const entryInsert = (tenantId: string, id: string, seq: number, total: number) => sql`
    insert into journal_entries (tenant_id, id, year, seq, number, entry_date, posting_date, kind,
      source_type, source_id, memo, base_currency, total_minor)
    values (${tenantId}, ${id}, 2026, ${seq}, ${`2026-${String(seq).padStart(7, '0')}`}, '2026-10-30',
      '2026-10-30', 'manual', 'manual', ${id}, 'تجربة', 'SYP', ${total})`;

  it('refuses to change or delete a posted entry or line', async () => {
    const store = await openStore(app);
    const { entryId } = await postedIds(store);
    expect(
      await asStore(store.tenantId, sql`update journal_entries set memo = 'x' where id = ${entryId}`),
    ).toBe('42501');
    expect(await asStore(store.tenantId, sql`delete from journal_lines where entry_id = ${entryId}`)).toBe(
      '42501',
    );
    // Even the owner role, which bypasses row-level security, cannot.
    await expect(
      ownerDb()`update journal_lines set debit_minor = 1 where entry_id = ${entryId}`,
    ).rejects.toThrow(/append-only/);
  });

  it('refuses an unbalanced entry, lines that do not make its total, and an entry without lines', async () => {
    const store = await openStore(app);
    const { cash, sales } = await postedIds(store);
    const id = newId();
    const unbalanced = sql`
      with e as (${entryInsert(store.tenantId, id, 90, 1000)} returning id)
      insert into journal_lines (tenant_id, entry_id, line_no, account_id, debit_minor, credit_minor, currency, amount_minor)
      select ${store.tenantId}, e.id, n, a, d, c, 'SYP', d - c
      from e, (values (1, ${cash}::uuid, 1000, 0), (2, ${sales}::uuid, 0, 999)) v(n, a, d, c)`;
    expect(await asStore(store.tenantId, unbalanced)).toBe('23514');
    const offTotal = sql`
      with e as (${entryInsert(store.tenantId, id, 90, 1000)} returning id)
      insert into journal_lines (tenant_id, entry_id, line_no, account_id, debit_minor, credit_minor, currency, amount_minor)
      select ${store.tenantId}, e.id, n, a, d, c, 'SYP', d - c
      from e, (values (1, ${cash}::uuid, 500, 0), (2, ${sales}::uuid, 0, 500)) v(n, a, d, c)`;
    expect(await asStore(store.tenantId, offTotal)).toBe('23514');
    expect(await asStore(store.tenantId, entryInsert(store.tenantId, id, 90, 0))).toBe('23514');
    const balanced = sql`
      with e as (${entryInsert(store.tenantId, id, 90, 1000)} returning id)
      insert into journal_lines (tenant_id, entry_id, line_no, account_id, debit_minor, credit_minor, currency, amount_minor)
      select ${store.tenantId}, e.id, n, a, d, c, 'SYP', d - c
      from e, (values (1, ${cash}::uuid, 1000, 0), (2, ${sales}::uuid, 0, 1000)) v(n, a, d, c)`;
    expect(await asStore(store.tenantId, balanced)).toBeUndefined();
  });

  it('refuses a line on a group, a dollar on the pounds drawer, and both sides on one line', async () => {
    const store = await openStore(app);
    const { cash, group, sales } = await postedIds(store);
    const lines = (a: string, currency: string, debit: number, credit: number) => sql`
      with e as (${entryInsert(store.tenantId, newId(), 91, 1000)} returning id)
      insert into journal_lines (tenant_id, entry_id, line_no, account_id, debit_minor, credit_minor, currency, amount_minor)
      select ${store.tenantId}, e.id, n, acc, d, c, cur, d - c
      from e, (values (1, ${a}::uuid, ${debit}::bigint, ${credit}::bigint, ${currency}),
                      (2, ${sales}::uuid, 0::bigint, 1000::bigint, 'SYP')) v(n, acc, d, c, cur)`;
    expect(await asStore(store.tenantId, lines(group, 'SYP', 1000, 0))).toBe('23514');
    expect(await asStore(store.tenantId, lines(cash, 'USD', 1000, 0))).toBe('23514');
    expect(await asStore(store.tenantId, lines(cash, 'SYP', 2000, 1000))).toBe('23514');
  });

  it('keeps each store to its own ledger', async () => {
    const a = await openStore(app, '0911111111');
    const b = await openStore(app, '0922222222');
    await postedIds(a);
    const seen = await withTenant(appDb().db, b.tenantId, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from journal_entries`),
    );
    expect(seen[0]!.n).toBe(0);
    const [accountOfA] = await ownerDb()<{ id: string }[]>`
      select id from accounts where tenant_id = ${a.tenantId} and code = '4100'`;
    const [cashOfB] = await ownerDb()<{ id: string }[]>`
      select id from accounts where tenant_id = ${b.tenantId} and code = '111001'`;
    const crossed = sql`
      with e as (${entryInsert(b.tenantId, newId(), 1, 1000)} returning id)
      insert into journal_lines (tenant_id, entry_id, line_no, account_id, debit_minor, credit_minor, currency, amount_minor)
      select ${b.tenantId}, e.id, n, acc, d, c, 'SYP', d - c
      from e, (values (1, ${cashOfB!.id}::uuid, 1000, 0), (2, ${accountOfA!.id}::uuid, 0, 1000)) v(n, acc, d, c)`;
    expect(await asStore(b.tenantId, crossed)).toBe('23503');
  });
});

describe('balances after a day', () => {
  it('the drawer of a shift holds its takings, net of what moved, and the close’s difference', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc('sale', goldenFirstSale(store, open.id));
    const drop = doc('cash_movement', movement(store.userId, open.id, 'safe_drop', 10000));
    const close = doc(
      'shift_close',
      shiftClose(store.userId, open.id, [
        { currency: 'SYP', opening: 100000, cashIn: 20000, changeOut: 8000, drops: 10000, counted: 101000 },
        { currency: 'USD', opening: 0, cashIn: 900, counted: 900 },
      ]),
    );
    await push(app, store.device, [open, sold, drop, close]);
    const b = await balances(store.tenantId);
    // Expected 102,000 − opening 100,000 = 2,000 of takings; counted 1,000 short.
    expect(b.get('111001')).toEqual({ base: 1000, amount: 1000 });
    expect(b.get('111002')).toEqual({ base: 117000, amount: 900 });
    expect(b.get('112001')).toEqual({ base: 10000, amount: 10000 });
    expect(b.get('6200')).toEqual({ base: 1000, amount: 1000 });
    const total = [...b.values()].reduce((acc, v) => acc + v.base, 0);
    expect(total).toBe(0);
  });
});
