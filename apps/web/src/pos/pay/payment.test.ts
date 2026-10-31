import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateDocumentPayload } from '@serva/core/contracts/documents';
import { buildSalePayload, settleSale, verifySalePayload } from '@serva/core/sale';
import { buildCatalog } from '../catalog';
import { addItem, EMPTY_CART, pricingInput, priceCart, type Cart } from '../sale/cart';
import { posSets } from '../../test/pos';
import { amountText, changeNotes, parseAmount, quickAmounts } from './payment';

const ctx = {
  currency: 'SYP' as const,
  taxInclusive: true,
  rates: [{ unit: 'USD' as const, quote: 'SYP' as const, rate: '130' }],
};
const catalog = buildCatalog(posSets());
const sellable = catalog.items;

describe('payment helpers', () => {
  it('quick notes start with the exact amount and only go up (kit: 1,250 → 1,300 · 1,500 · 2,000 · 2,500 · 5,000)', () => {
    expect(quickAmounts(125_000, 'SYP')).toEqual([125_000, 130_000, 150_000, 200_000, 250_000, 500_000]);
    expect(quickAmounts(962, 'USD')).toEqual([962, 1_000, 2_000, 5_000, 10_000]);
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000_00 }),
        fc.constantFrom('SYP' as const, 'USD' as const),
        (due, currency) => {
          const notes = quickAmounts(due, currency);
          expect(notes[0]).toBe(due);
          expect(notes.every((n) => n >= due)).toBe(true);
          expect(new Set(notes).size).toBe(notes.length);
        },
      ),
    );
  });

  it('reads back every amount it shows', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000_00 }),
        fc.constantFrom('SYP' as const, 'USD' as const),
        (minor, currency) => {
          expect(parseAmount(amountText(minor, currency), currency)).toBe(minor);
        },
      ),
    );
    expect(parseAmount('12.345', 'USD')).toBeNull();
    expect(parseAmount('', 'SYP')).toBeNull();
  });

  it('hands the change back in notes when it can, largest first', () => {
    expect(changeNotes(31_000, [50_000, 20_000, 10_000, 5_000, 2_500, 1_000])).toEqual([
      20_000, 10_000, 1_000,
    ]);
    expect(changeNotes(150, [1_000])).toEqual([]);
  });
});

describe('cart to sale document (property)', () => {
  const cartArb = fc
    .array(
      fc.record({
        item: fc.integer({ min: 0, max: sellable.length - 1 }),
        qty: fc.integer({ min: 1, max: 20 }),
        percent: fc.option(fc.integer({ min: 1, max: 5000 }), { nil: null }),
      }),
      { minLength: 1, maxLength: 12 },
    )
    .map((picks) =>
      picks.reduce<Cart>((cart, p) => {
        const item = sellable[p.item]!;
        const next = addItem(cart, item, null, item.unit?.allowsFraction ? p.qty * 125 : p.qty * 1000);
        if (p.percent === null) return next;
        const last = next.lines[next.lines.length - 1]!;
        return {
          ...next,
          lines: next.lines.map((l) =>
            l === last
              ? {
                  ...l,
                  adjustment: {
                    kind: 'discount' as const,
                    discount: { type: 'percent' as const, bp: p.percent! },
                  },
                }
              : l,
          ),
        };
      }, EMPTY_CART),
    );

  it('what the screen shows is what the document carries, and it always balances', () => {
    fc.assert(
      fc.property(
        cartArb,
        fc.integer({ min: 0, max: 200_000_00 }),
        fc.integer({ min: 0, max: 500_00 }),
        (cart, extraSyp, usd) => {
          const shown = priceCart(cart, ctx).priced.totals.totalMinor;
          const settle = settleSale({
            currency: 'SYP',
            exchangeRates: ctx.rates,
            totalMinor: shown,
            payments: usd > 0 ? [{ method: 'cash', currency: 'USD', amountMinor: usd }] : [],
            cashSteps: {},
          });
          const syp = settle.remainingCashMinor + extraSyp;
          const payments = [
            ...(usd > 0 ? [{ method: 'cash' as const, currency: 'USD' as const, amountMinor: usd }] : []),
            ...(syp > 0 ? [{ method: 'cash' as const, currency: 'SYP' as const, amountMinor: syp }] : []),
          ];
          if (payments.length === 0) return;
          const payload = buildSalePayload({
            ...pricingInput(cart, ctx),
            shiftId: '0192a000-0000-7000-8000-00000000ffff',
            cashierId: '0192a000-0000-7000-8000-0000000000d1',
            payments,
            cashSteps: {},
          });
          expect(payload.totals.totalMinor).toBe(shown);
          expect(validateDocumentPayload('sale', payload)).toEqual({ ok: true, checked: true });
          expect(verifySalePayload(payload)).toEqual([]);
        },
      ),
      { numRuns: 150 },
    );
  });
});
