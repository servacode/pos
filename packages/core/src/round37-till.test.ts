import { describe, expect, it } from 'vitest';
import { INSTALMENT_FEE_NAME, INSTALMENT_FEE_PRODUCT_ID, INSTALMENT_FEE_VARIANT_ID } from './installments';
import { buildReturnPayload, withInstalmentFee, type ReturnedLine } from './sale-return';
import {
  heldCartHoursOf,
  holdExpiryDaysOf,
  HELD_CART_HOURS,
  HOLD_EXPIRY_DAYS,
  showOldPoundOn,
  tillSettingsSchema,
  tillProductInput,
} from './contracts/till';
import type { SalePayload } from './contracts/documents';

describe('decision 8: the «بالقديم» line', () => {
  it('is on for a store that never set it, until the end of July 2027, then off by itself', () => {
    expect(showOldPoundOn(undefined, '2026-11-18T10:00:00+03:00')).toBe(true);
    expect(showOldPoundOn(null, '2027-07-31T20:59:00Z')).toBe(true);
    // 31 July 2027 at 23:59 in Damascus is still the last day; the next minute is August
    expect(showOldPoundOn({}, '2027-07-31T23:59:00+03:00')).toBe(true);
    expect(showOldPoundOn({}, '2027-08-01T00:00:00+03:00')).toBe(false);
    expect(showOldPoundOn({}, '2028-01-01T12:00:00Z')).toBe(false);
  });

  it('keeps the choice of a store that set it, either way, on any date', () => {
    expect(showOldPoundOn({ showOldPound: false }, '2026-11-18T10:00:00Z')).toBe(false);
    expect(showOldPoundOn({ showOldPound: true }, '2029-05-05T10:00:00Z')).toBe(true);
  });

  it('is not guessed from a bad date', () => {
    expect(showOldPoundOn({}, 'not a date')).toBe(false);
  });
});

describe('decision 14: the settings of a reservation', () => {
  it('default to 7 days for a customer’s hold and 12 hours for a cart put aside, and are the store’s own when set', () => {
    expect(holdExpiryDaysOf(null)).toBe(HOLD_EXPIRY_DAYS);
    expect(heldCartHoursOf({})).toBe(HELD_CART_HOURS);
    expect(holdExpiryDaysOf({ holdExpiryDays: 3 })).toBe(3);
    expect(heldCartHoursOf({ heldCartHours: 24 })).toBe(24);
  });

  it('are bounded, and an older till’s settings (without them) still parse', () => {
    const base = { returnWindowDays: null, cardApprovalRequired: false };
    expect(tillSettingsSchema.safeParse(base).success).toBe(true);
    expect(tillSettingsSchema.safeParse({ ...base, holdExpiryDays: 0 }).success).toBe(false);
    expect(tillSettingsSchema.safeParse({ ...base, holdExpiryDays: 91 }).success).toBe(false);
    expect(tillSettingsSchema.safeParse({ ...base, heldCartHours: 73 }).success).toBe(false);
    expect(tillSettingsSchema.safeParse({ ...base, holdExpiryDays: 30, heldCartHours: 2 }).success).toBe(
      true,
    );
  });
});

describe('decision 15: the new product from the till', () => {
  const ok = {
    actorId: '0194c8a0-0000-7000-8000-000000000001',
    nameAr: ' قميص ',
    priceMinor: 450_000,
    categoryId: null,
    barcode: '٦٢٩١٠٤١٥٠٠٢١٣',
  };
  it('reads Arabic digits in the barcode, trims the name, and needs a name and a price above zero', () => {
    expect(tillProductInput.parse(ok)).toMatchObject({ nameAr: 'قميص', barcode: '6291041500213' });
    expect(tillProductInput.safeParse({ ...ok, nameAr: '   ' }).success).toBe(false);
    expect(tillProductInput.safeParse({ ...ok, priceMinor: 0 }).success).toBe(false);
    expect(tillProductInput.safeParse({ ...ok, barcode: 'ab' }).success).toBe(false);
  });
});

describe('decision 18: the instalment fee goes back with the goods', () => {
  const line = (lineNo: number, totalMinor: number, extra: Record<string, unknown> = {}) => ({
    lineNo,
    productId: '0194c8a0-0000-7000-8000-0000000000a1',
    variantId: '0194c8a0-0000-7000-8000-0000000000a2',
    name: 'سلعة',
    unitSymbol: null,
    barcode: null,
    packQty: 1000,
    packName: null,
    qty: 1000,
    priceCurrency: 'SYP',
    priceMinor: totalMinor,
    taxRateId: null,
    taxRateBp: 0,
    adjustment: null,
    approval: null,
    priced: { grossExTaxMinor: totalMinor, discountExTaxMinor: 0, taxMinor: 0, totalMinor },
    ...extra,
  });
  const fee = (totalMinor: number) =>
    line(2, totalMinor, {
      productId: INSTALMENT_FEE_PRODUCT_ID,
      variantId: INSTALMENT_FEE_VARIANT_ID,
      name: INSTALMENT_FEE_NAME,
    });
  const withPlan = (goods: number, feeMinor: number): SalePayload =>
    ({
      currency: 'SYP',
      customerId: 'c1',
      lines: [line(1, goods), fee(feeMinor)],
      installmentPlan: { markupMinor: feeMinor },
      payments: [],
      totals: { totalMinor: goods + feeMinor },
    }) as unknown as SalePayload;

  it('does nothing to a sale with no plan, nor to a return that picks only the fee line', () => {
    const plain = { ...withPlan(100_000, 4_000), installmentPlan: undefined } as SalePayload;
    expect(withInstalmentFee(plain, [{ saleLineNo: 1, qty: 500 }])).toEqual([{ saleLineNo: 1, qty: 500 }]);
    const sale = withPlan(100_000, 4_000);
    expect(withInstalmentFee(sale, [{ saleLineNo: 2, qty: 1000 }])).toEqual([{ saleLineNo: 2, qty: 1000 }]);
  });

  it('takes the fee in proportion to the goods returned, and in full when the whole sale returns', () => {
    const sale = withPlan(100_000, 4_000);
    expect(withInstalmentFee(sale, [{ saleLineNo: 1, qty: 500 }])).toEqual([
      { saleLineNo: 1, qty: 500 },
      { saleLineNo: 2, qty: 500 },
    ]);
    expect(withInstalmentFee(sale, [{ saleLineNo: 1, qty: 1000 }])).toEqual([
      { saleLineNo: 1, qty: 1000 },
      { saleLineNo: 2, qty: 1000 },
    ]);
  });

  it('replaces a hand-picked fee with what it works out, and counts earlier returns', () => {
    const sale = withPlan(100_000, 4_000);
    const earlier: ReturnedLine[] = [
      {
        saleLineNo: 1,
        qty: 250,
        grossExTaxMinor: 25_000,
        discountExTaxMinor: 0,
        taxMinor: 0,
        totalMinor: 25_000,
      },
      {
        saleLineNo: 2,
        qty: 250,
        grossExTaxMinor: 1_000,
        discountExTaxMinor: 0,
        taxMinor: 0,
        totalMinor: 1_000,
      },
    ];
    // The cashier ticked the whole fee by hand for a part return: it is not honoured
    expect(
      withInstalmentFee(
        sale,
        [
          { saleLineNo: 1, qty: 250 },
          { saleLineNo: 2, qty: 1000 },
        ],
        earlier,
      ),
    ).toEqual([
      { saleLineNo: 1, qty: 250 },
      { saleLineNo: 2, qty: 250 },
    ]);
    // The rest of the goods takes the rest of the fee
    expect(withInstalmentFee(sale, [{ saleLineNo: 1, qty: 750 }], earlier)).toEqual([
      { saleLineNo: 1, qty: 750 },
      { saleLineNo: 2, qty: 750 },
    ]);
  });

  it('builds a return whose fee and goods add up to what the account is credited', () => {
    const sale = withPlan(100_000, 4_000);
    const ret = buildReturnPayload({
      sale,
      saleId: 's1',
      saleNumber: 'INV-1',
      shiftId: 'sh1',
      cashierId: 'u1',
      reason: 'x',
      picks: withInstalmentFee(sale, [{ saleLineNo: 1, qty: 500 }]),
      refundMethod: 'account',
    });
    expect(ret.totals.totalMinor).toBe(52_000);
    expect(ret.refunds[0]).toMatchObject({ method: 'account', amountMinor: 52_000 });
  });
});
