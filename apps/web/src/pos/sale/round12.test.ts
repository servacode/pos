import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../catalog';
import { sellableOnHand, shortfallOf } from '../../lib/sellable';
import { armClickGuard, clicksSwallowed, setClickGuardEnabled } from './clickGuard';
import { sizeStock, stockFor } from './models';
import { isUnfedService, withoutUnfedServices } from './serviceFee';
import { tileInfo } from './tileInfo';
import { matchesNumber, returnableSales } from '../return/returns';
import type { Cart, CartLine } from './cart';

const item = (over: Partial<CatalogItem>) => over as CatalogItem;

describe('the one stock rule at the till', () => {
  it('counts a combination below zero as nothing, so it never hides the others', () => {
    expect(sellableOnHand(-1000)).toBe(0);
    expect(sellableOnHand(5000)).toBe(5000);
    expect(shortfallOf([2000, -1000, -3000])).toBe(4000);
    const info = tileInfo(
      [item({ stockQty: 7000 }), item({ stockQty: -1000 }), item({ stockQty: 7000 })],
      '2026-11-14',
    );
    expect(info.stockQty).toBe(14000);
    const pieces = [
      item({ variantId: 'a', attributes: [{ name: 'المقاس', value: 'M' }], stockQty: 3000 }),
      item({ variantId: 'b', attributes: [{ name: 'المقاس', value: 'M' }], stockQty: -2000 }),
    ];
    expect(stockFor(pieces, {}, 'المقاس', 'M')).toBe(3000);
  });

  it('says how many numbered units are out on rent', () => {
    expect(tileInfo([item({ stockQty: 2000, rentedCount: 1 })], '2026-11-14').rentedCount).toBe(1);
    expect(tileInfo([item({ stockQty: 2000 })], '2026-11-14').rentedCount).toBe(0);
  });
});

describe('sizes on a model tile', () => {
  const p = (size: string, qty: number | null, colour = 'أسود') =>
    item({
      variantId: `${size}-${colour}`,
      attributes: [
        { name: 'المقاس', value: size },
        { name: 'اللون', value: colour },
      ],
      stockQty: qty,
    });
  it('lists the sizes in natural order with the empty ones marked', () => {
    const sizes = sizeStock([p('L', 0), p('S', 2000), p('M', 1000), p('M', 0, 'أبيض')]);
    expect(sizes).toEqual([
      { value: 'S', inStock: true, left: 2000 },
      { value: 'M', inStock: true, left: 1000 },
      { value: 'L', inStock: false, left: 0 },
    ]);
  });
  it('has nothing to say for a colour-only model', () => {
    const colour = item({ attributes: [{ name: 'اللون', value: 'أحمر' }], stockQty: 1000 });
    expect(sizeStock([colour])).toBeNull();
  });
});

describe('a service whose fee was never typed', () => {
  const byVariant = new Map<string, CatalogItem>([
    [
      'svc',
      item({
        variantId: 'svc',
        isService: true,
        price: { currency: 'SYP', priceMinor: 0, minPriceMinor: null },
      }),
    ],
    ['good', item({ variantId: 'good', price: { currency: 'SYP', priceMinor: 500, minPriceMinor: null } })],
  ]);
  const line = (variantId: string, priceMinor: number) =>
    ({ lineNo: 1, variantId, priceMinor, adjustment: null }) as unknown as CartLine;
  it('is found and dropped, the rest of the cart stays', () => {
    expect(isUnfedService(line('svc', 0), byVariant)).toBe(true);
    expect(isUnfedService(line('svc', 3500), byVariant)).toBe(false);
    expect(isUnfedService(line('good', 500), byVariant)).toBe(false);
    const cart = { lines: [line('svc', 0), line('good', 500)] } as unknown as Cart;
    expect(withoutUnfedServices(cart, byVariant).lines.map((l) => l.variantId)).toEqual(['good']);
    const clean = { lines: [line('good', 500)] } as unknown as Cart;
    expect(withoutUnfedServices(clean, byVariant)).toBe(clean);
  });
});

describe('the click guard', () => {
  it('swallows clicks for a moment after a close', () => {
    setClickGuardEnabled(true);
    armClickGuard(1_000);
    expect(clicksSwallowed(1_200)).toBe(true);
    expect(clicksSwallowed(1_400)).toBe(false);
    setClickGuardEnabled(false);
    armClickGuard(1_000);
    expect(clicksSwallowed(1_200)).toBe(false);
  });
});

describe('returns list', () => {
  it('finds an invoice by its number from the start, any case', () => {
    expect(matchesNumber('INV-001-014-1', 'INV-001-014')).toBe(true);
    expect(matchesNumber('INV-001-014-1', 'inv-001-014')).toBe(true);
    expect(matchesNumber('INV-001-015-1', 'INV-001-014')).toBe(false);
  });
  it('lists the newest first even when the offsets differ', () => {
    const entry = (id: string, deviceTime: string) =>
      ({ doc: { id, type: 'sale', number: id, deviceTime, payload: {} } }) as never;
    const list = returnableSales(
      [entry('old', '2026-11-14T10:00:00+03:00'), entry('new', '2026-11-14T08:00:00Z')],
      Date.parse('2026-11-14T12:00:00Z'),
    );
    expect(list.map((s) => s.id)).toEqual(['new', 'old']);
  });
});
