import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expenseInput, manualEntryInput } from './contracts/ledger-docs';
import {
  buildProfitLoss,
  expenseLines,
  manualEntryLines,
  reversalLines,
  runStatement,
  type LedgerLine,
} from './ledger-rules';

const sum = (lines: LedgerLine[]) => lines.reduce((acc, l) => acc + l.baseMinor, 0);
const usd = { unit: 'USD', quote: 'SYP', rate: '130' } as const;
const BRANCH = '0197a2c0-0000-7000-8000-000000000001';

describe('statements (29 › كشف حساب)', () => {
  it('a customer: opening plus debits minus credits, every line carrying its balance', () => {
    const s = runStatement(
      1000,
      [
        { debitMinor: 500, creditMinor: 0 },
        { debitMinor: 0, creditMinor: 700 },
      ],
      'debit',
    );
    expect(s.lines.map((l) => l.balanceMinor)).toEqual([1500, 800]);
    expect(s.closingMinor).toBe(800);
    expect(s.totalDebitMinor).toBe(500);
    expect(s.totalCreditMinor).toBe(700);
  });

  it('a supplier: credits raise what is owed, payments lower it', () => {
    const s = runStatement(
      0,
      [
        { debitMinor: 0, creditMinor: 3000 },
        { debitMinor: 1000, creditMinor: 0 },
      ],
      'credit',
    );
    expect(s.lines.map((l) => l.balanceMinor)).toEqual([3000, 2000]);
    expect(s.closingMinor).toBe(2000);
  });

  it('closing always equals opening plus the signed movements', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e6, max: 1e6 }),
        fc.array(fc.record({ debitMinor: fc.nat(1e5), creditMinor: fc.nat(1e5) })),
        fc.constantFrom('debit' as const, 'credit' as const),
        (opening, moves, side) => {
          const s = runStatement(opening, moves, side);
          const net = moves.reduce((a, m) => a + m.debitMinor - m.creditMinor, 0);
          expect(s.closingMinor).toBe(opening + (side === 'debit' ? net : -net));
        },
      ),
    );
  });
});

describe('expense entry (29)', () => {
  it('base currency: debit the expense, credit the safe, balanced', () => {
    const lines = expenseLines(
      { accountCode: '6101', amountMinor: 250000, currency: 'SYP', payFrom: 'safe', note: 'إيجار' },
      'SYP',
      null,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ account: { code: '6101' }, baseMinor: 250000 });
    expect(lines[1]).toMatchObject({ account: { cash: '1120', currency: 'SYP' }, baseMinor: -250000 });
    expect(sum(lines)).toBe(0);
  });

  it('a dollar expense keeps its dollars and rate on the paying line and books the base on the expense', () => {
    const lines = expenseLines(
      { accountCode: '6102', amountMinor: 1250, currency: 'USD', payFrom: 'bank', note: null },
      'SYP',
      usd,
    );
    // 12.50 USD at 130 = 1,625.00 SYP
    expect(lines[0]).toMatchObject({ baseMinor: 162500, currency: 'SYP' });
    expect(lines[1]).toMatchObject({
      account: { code: '1130' },
      baseMinor: -162500,
      currency: 'USD',
      amountMinor: -1250,
      rate: usd,
    });
    expect(sum(lines)).toBe(0);
  });

  it.each([
    ['wallet', '1150'],
    ['card', '1140'],
  ] as const)('paid by %s: credits its account %s', (payFrom, code) => {
    const lines = expenseLines(
      { accountCode: '6101', amountMinor: 900, currency: 'SYP', payFrom, note: null },
      'SYP',
      null,
    );
    expect(lines[1]).toMatchObject({ account: { code }, baseMinor: -900 });
    expect(sum(lines)).toBe(0);
  });

  it('refuses an account outside the expense range', () => {
    const bad = expenseInput.safeParse({
      date: '2026-11-01',
      branchId: BRANCH,
      accountCode: '1110',
      amountMinor: 100,
      currency: 'SYP',
      payFrom: 'safe',
    });
    expect(bad.success).toBe(false);
  });
});

describe('manual entries (29)', () => {
  const entry = (lines: object[]) =>
    manualEntryInput.parse({ date: '2026-11-01', branchId: BRANCH, memo: 'تسوية', lines });

  it('posts a balanced entry', () => {
    const input = entry([
      { accountCode: '6190', debitMinor: 5000 },
      { accountCode: '1120', creditMinor: 5000 },
    ]);
    const r = manualEntryLines(input, 'SYP', () => null);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.totalMinor).toBe(5000);
      expect(sum(r.lines)).toBe(0);
    }
  });

  it('refuses an unbalanced entry', () => {
    const input = entry([
      { accountCode: '6190', debitMinor: 5000 },
      { accountCode: '1120', creditMinor: 4999 },
    ]);
    expect(manualEntryLines(input, 'SYP', () => null)).toMatchObject({ ok: false });
  });

  it('refuses a line on both sides or on none, and a single line', () => {
    const credit = { accountCode: '1120', creditMinor: 1 };
    expect(() => entry([{ accountCode: '6190', debitMinor: 1, creditMinor: 1 }, credit])).toThrow();
    expect(() => entry([{ accountCode: '6190' }, credit])).toThrow();
    expect(() => entry([{ accountCode: '6190', debitMinor: 1 }])).toThrow();
  });

  it('a foreign line converts at the rate and a missing rate is refused', () => {
    const input = entry([
      { accountCode: '1120', debitMinor: 1000, currency: 'USD' },
      { accountCode: '3150', creditMinor: 130000 },
    ]);
    expect(manualEntryLines(input, 'SYP', () => null)).toMatchObject({ ok: false });
    expect(manualEntryLines(input, 'SYP', () => usd).ok).toBe(true);
  });

  it('refuses a foreign line too small to reach one minor unit of the base currency', () => {
    // A dollar store: one piastre of pounds at 13,000 a dollar is far less than a cent.
    const input = entry([
      { accountCode: '1120', debitMinor: 1, currency: 'SYP' },
      { accountCode: '3150', creditMinor: 1 },
    ]);
    const pounds = { unit: 'USD', quote: 'SYP', rate: '13000' } as const;
    expect(manualEntryLines(input, 'USD', () => pounds)).toMatchObject({
      ok: false,
      field: 'lines.0.debitMinor',
    });
  });

  it('property: random balanced entries balance; their reversal cancels line by line', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 1e7 }), { minLength: 1, maxLength: 8 }), (amounts) => {
        const total = amounts.reduce((a, b) => a + b, 0);
        const input = entry([
          ...amounts.map((a) => ({ accountCode: '6190', debitMinor: a })),
          { accountCode: '1120', creditMinor: total },
        ]);
        const r = manualEntryLines(input, 'SYP', () => null);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(sum(r.lines)).toBe(0);
        const back = reversalLines(r.lines);
        expect(back.map((l, i) => l.baseMinor + r.lines[i]!.baseMinor)).toEqual(r.lines.map(() => 0));
      }),
    );
  });
});

describe('profit and loss (29)', () => {
  const rows = [
    { code: '4100', name: 'المبيعات', debitMinor: 0, creditMinor: 1000000 },
    { code: '4200', name: 'الحسميات الممنوحة', debitMinor: 50000, creditMinor: 0 },
    { code: '4300', name: 'مردودات المبيعات', debitMinor: 30000, creditMinor: 0 },
    { code: '5100', name: 'كلفة المبيعات', debitMinor: 600000, creditMinor: 0 },
    { code: '4920', name: 'إيرادات متنوعة', debitMinor: 0, creditMinor: 10000 },
    { code: '6101', name: 'الإيجار', debitMinor: 100000, creditMinor: 0 },
    { code: '6102', name: 'الكهرباء', debitMinor: 20000, creditMinor: 0 },
    { code: '6200', name: 'عجز وزيادة الصندوق', debitMinor: 5000, creditMinor: 0 },
    { code: '1110', name: 'الصندوق', debitMinor: 999, creditMinor: 0 },
  ];
  const head = { from: '2026-11-01', to: '2026-11-30', branchId: null, baseCurrency: 'SYP' as const };

  it('adds revenue, cost, gross, other income, grouped expenses and the net', () => {
    const p = buildProfitLoss(rows, head);
    expect(p.revenue.totalMinor).toBe(1000000 - 50000 - 30000);
    expect(p.costOfSales.totalMinor).toBe(600000);
    expect(p.grossProfitMinor).toBe(320000);
    expect(p.otherIncome.totalMinor).toBe(10000);
    expect(p.expenses.groups.map((g) => [g.code, g.totalMinor])).toEqual([
      ['61', 120000],
      ['62', 5000],
    ]);
    expect(p.netProfitMinor).toBe(320000 + 10000 - 125000);
  });

  it('a period without movement is all zeros', () => {
    const p = buildProfitLoss([], head);
    expect(p.netProfitMinor).toBe(0);
    expect(p.expenses.groups).toEqual([]);
  });
});
