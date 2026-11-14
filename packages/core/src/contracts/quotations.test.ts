import { describe, expect, it } from 'vitest';
import {
  addDays,
  effectiveQuotationStatus,
  priceQuotation,
  quotationInput,
  quotationLineInput,
  QUOTATION_NEXT,
  QUOTATION_STATUSES,
  quotationListQuery,
} from './quotations';

const line = (over: Record<string, unknown> = {}) =>
  quotationLineInput.parse({ name: 'قفازات', qty: 2000, unitPriceMinor: 10_000, ...over });

describe('quotation input', () => {
  it('fills a line with a piece, no tax and no discount', () => {
    const l = line();
    expect(l).toMatchObject({ packQty: 1000, taxRateBp: 0, discount: null, productId: null });
  });

  it('needs at least one line', () => {
    expect(quotationInput.safeParse({ lines: [] }).success).toBe(false);
    expect(quotationInput.safeParse({ lines: [{ name: 'a', qty: 1000, unitPriceMinor: 5 }] }).success).toBe(
      true,
    );
  });

  it('lists everything by default', () => {
    expect(quotationListQuery.parse({}).status).toBe('all');
    expect(quotationListQuery.parse({ status: 'open' }).status).toBe('open');
  });
});

describe('status', () => {
  it('a waiting quotation past its day reads expired', () => {
    expect(effectiveQuotationStatus('sent', '2026-11-01', '2026-11-02')).toBe('expired');
    expect(effectiveQuotationStatus('draft', '2026-11-01', '2026-11-02')).toBe('expired');
    expect(effectiveQuotationStatus('accepted', '2026-11-01', '2026-11-02')).toBe('expired');
  });

  it('stands on its last day, and a converted one never expires', () => {
    expect(effectiveQuotationStatus('sent', '2026-11-02', '2026-11-02')).toBe('sent');
    expect(effectiveQuotationStatus('converted', '2026-01-01', '2026-11-02')).toBe('converted');
    expect(effectiveQuotationStatus('expired', '2026-11-05', '2026-11-02')).toBe('expired');
  });

  it('every status has a way out except none stuck', () => {
    for (const s of QUOTATION_STATUSES) expect(QUOTATION_NEXT[s].length).toBeGreaterThan(0);
  });
});

describe('addDays', () => {
  it('crosses a month and a year', () => {
    expect(addDays('2026-11-20', 15)).toBe('2026-12-05');
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
  });
});

describe('priceQuotation', () => {
  it('prices tax-inclusive lines like the till', () => {
    const r = priceQuotation([line({ taxRateBp: 1000 })], null, true);
    expect(r.totals.totalMinor).toBe(20_000);
    expect(r.totals.taxMinor).toBe(1818);
    expect(r.lines[0]).toMatchObject({ lineNo: 1 });
    expect(r.lines[0]!.priced.totalMinor).toBe(20_000);
  });

  it('adds tax on top when prices are tax-exclusive', () => {
    const r = priceQuotation([line({ taxRateBp: 1000 })], null, false);
    expect(r.totals.taxMinor).toBe(2000);
    expect(r.totals.totalMinor).toBe(22_000);
  });

  it('applies a line discount and an invoice discount', () => {
    const r = priceQuotation(
      [line({ discount: { type: 'percent', bp: 1000 } }), line({ discount: { type: 'amount', minor: 500 } })],
      { type: 'amount', minor: 1000 },
      true,
    );
    expect(r.totals.lineDiscountMinor).toBe(2000 + 500);
    expect(r.totals.invoiceDiscountMinor).toBe(1000);
    expect(r.totals.totalMinor).toBe(40_000 - 2500 - 1000);
  });

  it('refuses a discount larger than the line', () => {
    expect(() =>
      priceQuotation([line({ discount: { type: 'amount', minor: 999_999 } })], null, true),
    ).toThrow(RangeError);
  });
});
