import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSalePayload } from '@serva/core/sale';
import type { PreparedRow } from '../admin/import/mapping';
import { oldToNew, applyOldPound, oldPoundPreview } from '../admin/import/oldPound';
import { scanBeep } from './beep';
import { receiptLines } from './print/lines';
import { receiptText } from './receipt/whatsapp';
import { isWeakConnection, recordProbe, resetProbe, startConnectionProbe, WEAK_AFTER } from './useOnline';

const ID = (n: number) => `0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a0${String(n)}`;

function sale(paidInDollars: boolean) {
  return buildSalePayload({
    currency: 'SYP',
    taxInclusive: true,
    exchangeRates: paidInDollars ? [{ unit: 'USD', quote: 'SYP', rate: '120' }] : [],
    shiftId: ID(3),
    cashierId: ID(4),
    cashSteps: {},
    lines: [
      {
        lineNo: 1,
        productId: ID(1),
        variantId: ID(2),
        name: 'زيت',
        qty: 1000,
        priceCurrency: 'SYP',
        priceMinor: 12_500,
        taxRateBp: 0,
      },
    ],
    payments: paidInDollars
      ? [{ method: 'cash', currency: 'USD', amountMinor: 200 }]
      : [{ method: 'cash', currency: 'SYP', amountMinor: 20_000 }],
  });
}

const dataFor = (payload: unknown, till?: Record<string, unknown>, deviceTime = '2026-10-30T09:00:00.000Z') =>
  ({
    doc: { number: 'INV-1', deviceTime, payload },
    settings: { storeName: 'مركز', timezone: 'Asia/Damascus', businessDayCutoff: '00:00', till },
    branch: null,
    storeName: 'مركز',
    branchName: 'فرع',
    deviceName: 'ص1',
    cashierName: 'سامر',
  }) as never;

describe('«بالقديم» on the receipt (display only)', () => {
  it('adds the old-pound total and change when the store turned it on', () => {
    const lines = receiptLines(dataFor(sale(false), { showOldPound: true }));
    // 125.00 new pounds are 12,500 old ones
    expect(lines).toContainEqual({ kind: 'pair', start: 'بالقديم', end: '12,500' });
    expect(lines).toContainEqual({ kind: 'pair', start: 'الباقي بالقديم', end: '7,500' });
    expect(receiptText(dataFor(sale(false), { showOldPound: true }))).toContain('بالقديم: 12,500');
  });

  it('says nothing for a store that turned it off, on any date', () => {
    expect(JSON.stringify(receiptLines(dataFor(sale(false), { showOldPound: false })))).not.toContain(
      'بالقديم',
    );
    expect(receiptText(dataFor(sale(false), { showOldPound: false }))).not.toContain('بالقديم');
  });

  // Round 37, decision 8: on by default for a store that never set it, off by itself after July 2027
  it('is on by default until the end of July 2027, then off by itself', () => {
    expect(receiptText(dataFor(sale(false)))).toContain('بالقديم: 12,500');
    expect(JSON.stringify(receiptLines(dataFor(sale(false))))).toContain('بالقديم');
    expect(receiptText(dataFor(sale(false), undefined, '2027-07-31T20:00:00.000Z'))).toContain('بالقديم');
    expect(receiptText(dataFor(sale(false), undefined, '2027-08-01T09:00:00.000Z'))).not.toContain('بالقديم');
    expect(JSON.stringify(receiptLines(dataFor(sale(false), {}, '2028-01-05T09:00:00.000Z')))).not.toContain(
      'بالقديم',
    );
  });

  it('keeps the choice of a store that set it, after July 2027 too', () => {
    expect(receiptText(dataFor(sale(false), { showOldPound: true }, '2028-01-05T09:00:00.000Z'))).toContain(
      'بالقديم: 12,500',
    );
  });
});

describe('the exchange rate on the receipt', () => {
  it('is printed when a dollar was paid, on paper and in the chat text', () => {
    const lines = receiptLines(dataFor(sale(true)));
    expect(lines.find((l) => l.kind === 'pair' && l.start === 'سعر الصرف')).toMatchObject({
      end: expect.stringContaining('120'),
    });
    expect(receiptText(dataFor(sale(true)))).toMatch(/سعر الصرف: .*120/);
  });

  it('is left out of a pound-only sale', () => {
    expect(JSON.stringify(receiptLines(dataFor(sale(false))))).not.toContain('سعر الصرف');
    expect(receiptText(dataFor(sale(false)))).not.toContain('سعر الصرف');
  });
});

describe('import «الأسعار بالليرة القديمة»', () => {
  it('divides on the digits, to the nearest piastre', () => {
    expect(oldToNew('85000')).toBe('850');
    expect(oldToNew('12,550')).toBe('125.5');
    expect(oldToNew('12555')).toBe('125.55');
    expect(oldToNew('12555.5')).toBe('125.56');
    expect(oldToNew('٨٥٠٠٠')).toBe('850');
    expect(oldToNew('50')).toBe('0.5');
    expect(oldToNew('5')).toBe('0.05');
    expect(oldToNew('0')).toBe('0');
    expect(oldToNew('-12500')).toBe('-125');
    expect(oldToNew('abc')).toBeNull();
  });

  it('changes only the money cells, and not a dollar row', () => {
    const rows: PreparedRow[] = [
      { line: 2, values: { name: 'زيت', barcode: '629100', price: '85000', cost: '60000', quantity: '10' } },
      { line: 3, values: { name: 'عطر', price: '25', currency: 'USD' } },
    ];
    const next = applyOldPound(rows);
    expect(next[0]!.values).toEqual({
      name: 'زيت',
      barcode: '629100',
      price: '850',
      cost: '600',
      quantity: '10',
    });
    expect(next[1]!.values).toEqual({ name: 'عطر', price: '25', currency: 'USD' });
    // The file's own rows are untouched
    expect(rows[0]!.values.price).toBe('85000');
  });

  it('previews before and after, and counts amounts that end under half a pound', () => {
    const rows: PreparedRow[] = [
      { line: 2, values: { price: '85000' } },
      { line: 3, values: { price: '30' } },
    ];
    const preview = oldPoundPreview(rows);
    expect(preview.samples[0]).toEqual({ line: 2, field: 'price', before: '85000', after: '850' });
    expect(preview.tiny).toBe(1);
  });
});

describe('a connection too weak to use', () => {
  afterEach(() => {
    resetProbe();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('turns weak after two failed probes in a row and back after one good one', () => {
    expect(isWeakConnection()).toBe(false);
    for (let i = 0; i < WEAK_AFTER - 1; i++) recordProbe(false);
    expect(isWeakConnection()).toBe(false);
    recordProbe(false);
    expect(isWeakConnection()).toBe(true);
    recordProbe(true);
    expect(isWeakConnection()).toBe(false);
  });

  it('counts a probe that never answers as a failure', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener('abort', () => reject(new Error('x'))),
        ),
    );
    const stop = startConnectionProbe();
    await vi.advanceTimersByTimeAsync(4_100);
    await vi.advanceTimersByTimeAsync(15_000 + 4_100);
    expect(isWeakConnection()).toBe(true);
    stop();
  });
});

describe('the scan sound', () => {
  it('is silent without Web Audio and when muted, and never throws', () => {
    expect(() => scanBeep('ok')).not.toThrow();
    expect(() => scanBeep('error', false)).not.toThrow();
  });
});
