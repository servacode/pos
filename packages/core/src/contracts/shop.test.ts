import { describe, expect, it } from 'vitest';
import { promotionInput } from './promotions';
import {
  onlineOrderDeliveryInput,
  onlineStoreInput,
  priceHistoryQuery,
  productTextsInput,
  shopOrderInput,
  SHOP_ACCENTS,
  stockAlertInput,
} from './shop';

const promo = { name: 'خصم', kind: 'percent', percentBp: 1000, scope: 'all' } as const;
const store = {
  version: null,
  enabled: true,
  slug: 'nour',
  whatsapp: null,
  delivery: true,
  pickup: true,
  note: null,
  showOutOfStock: false,
};

describe('«كود الخصم» on a promotion', () => {
  it('is optional, trimmed, 3 to 20 letters, digits, dashes and underscores', () => {
    expect(promotionInput.parse(promo).couponCode).toBeNull();
    expect(promotionInput.parse({ ...promo, couponCode: ' SUMMER-10 ' }).couponCode).toBe('SUMMER-10');
    expect(promotionInput.parse({ ...promo, couponCode: 'صيف_2026' }).couponCode).toBe('صيف_2026');
    for (const bad of ['ab', 'a'.repeat(21), 'a b', 'a<b>', 'a.b']) {
      expect(promotionInput.safeParse({ ...promo, couponCode: bad }).success, bad).toBe(false);
    }
  });
});

describe('the shop’s look', () => {
  it('takes one of the identity’s accents, emerald by default, and a short tagline', () => {
    expect(onlineStoreInput.parse(store)).toMatchObject({ accent: 'emerald', tagline: null });
    for (const accent of SHOP_ACCENTS)
      expect(onlineStoreInput.parse({ ...store, accent }).accent).toBe(accent);
    expect(onlineStoreInput.safeParse({ ...store, accent: '#fff' }).success).toBe(false);
    expect(onlineStoreInput.safeParse({ ...store, tagline: 'x'.repeat(81) }).success).toBe(false);
  });
});

describe('the delivery stage input', () => {
  const version = 3;
  it('needs a courier’s name to go out, none to be delivered', () => {
    expect(onlineOrderDeliveryInput.parse({ stage: 'out', courier: ' أبو علي ', version })).toEqual({
      stage: 'out',
      courier: 'أبو علي',
      version,
    });
    expect(onlineOrderDeliveryInput.safeParse({ stage: 'out', courier: ' ', version }).success).toBe(false);
    expect(onlineOrderDeliveryInput.safeParse({ stage: 'out', version }).success).toBe(false);
    expect(onlineOrderDeliveryInput.parse({ stage: 'delivered', version })).toEqual({
      stage: 'delivered',
      version,
    });
    expect(onlineOrderDeliveryInput.safeParse({ stage: 'lost', version }).success).toBe(false);
  });
});

describe('the other shop inputs', () => {
  it('keeps a coupon on the order as typed, or none', () => {
    const order = {
      name: 'ريم',
      phone: '0944555666',
      fulfilment: 'pickup',
      lines: [{ variantId: '0192a3b4-c5d6-7e8f-9a0b-00000000a001', qty: 1 }],
    };
    expect(shopOrderInput.parse(order).coupon).toBeNull();
    expect(shopOrderInput.parse({ ...order, coupon: ' summer10 ' }).coupon).toBe('summer10');
    expect(shopOrderInput.safeParse({ ...order, coupon: 'x'.repeat(21) }).success).toBe(false);
  });

  it('takes a phone for a piece that ran out, and a description of plain text', () => {
    const variantId = '0192a3b4-c5d6-7e8f-9a0b-00000000a001';
    expect(stockAlertInput.safeParse({ variantId, phone: '0944555666' }).success).toBe(true);
    expect(stockAlertInput.safeParse({ variantId, phone: '12' }).success).toBe(false);
    expect(productTextsInput.safeParse({ description: 'x'.repeat(4001), sizeGuide: null }).success).toBe(
      false,
    );
    expect(productTextsInput.safeParse({ description: null, sizeGuide: 'x'.repeat(2001) }).success).toBe(
      false,
    );
    expect(productTextsInput.safeParse({ description: 'نص', sizeGuide: 'مقاسات' }).success).toBe(true);
  });

  it('reads the price history filter: days, a product, a limit', () => {
    expect(priceHistoryQuery.parse({})).toEqual({ limit: 300 });
    expect(priceHistoryQuery.parse({ from: '2026-11-01', to: '2026-11-30', limit: '50' })).toMatchObject({
      from: '2026-11-01',
      limit: 50,
    });
    expect(priceHistoryQuery.safeParse({ from: 'junk' }).success).toBe(false);
    expect(priceHistoryQuery.safeParse({ limit: '5000' }).success).toBe(false);
    expect(priceHistoryQuery.safeParse({ productId: 'nope' }).success).toBe(false);
  });
});
