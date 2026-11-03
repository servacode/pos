import { describe, expect, it } from 'vitest';
import {
  bestPromotions,
  localClock,
  promotionActive,
  promotionDiscount,
  type PromotionLine,
  type PromotionRule,
} from './promotions';

const rule = (over: Partial<PromotionRule> = {}): PromotionRule => ({
  id: 'p1',
  name: 'عرض',
  kind: 'percent',
  percentBp: 1000,
  buyQty: null,
  getQty: null,
  scope: 'all',
  categoryIds: [],
  productIds: [],
  startsAt: null,
  endsAt: null,
  daysOfWeek: [],
  fromTime: null,
  toTime: null,
  archived: false,
  ...over,
});

const line = (over: Partial<PromotionLine> = {}): PromotionLine => ({
  lineNo: 1,
  productId: 'milk',
  categoryPath: ['dairy', 'food'],
  qty: 3000,
  unitPriceMinor: 10_000,
  weighed: false,
  ...over,
});

const DAMASCUS = 'Asia/Damascus';
// Tuesday 3 November 2026, 14:30 in Damascus (UTC+3)
const TUESDAY_1430 = new Date('2026-11-03T11:30:00Z');

describe('localClock', () => {
  it('reads the store’s weekday and time', () => {
    expect(localClock(TUESDAY_1430, DAMASCUS)).toEqual({ weekday: 2, time: '14:30' });
    expect(localClock(new Date('2026-11-07T21:05:00Z'), DAMASCUS)).toEqual({ weekday: 0, time: '00:05' });
  });
});

describe('promotionActive', () => {
  it('runs between its dates, the end excluded', () => {
    const r = rule({ startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-03T11:30:00Z' });
    expect(promotionActive(r, new Date('2026-10-31T23:59:59Z'), DAMASCUS)).toBe(false);
    expect(promotionActive(r, new Date('2026-11-02T00:00:00Z'), DAMASCUS)).toBe(true);
    expect(promotionActive(r, TUESDAY_1430, DAMASCUS)).toBe(false);
  });

  it('runs on its days and hours only, a window past midnight included', () => {
    expect(promotionActive(rule({ daysOfWeek: [2] }), TUESDAY_1430, DAMASCUS)).toBe(true);
    expect(promotionActive(rule({ daysOfWeek: [5, 6] }), TUESDAY_1430, DAMASCUS)).toBe(false);
    const day = rule({ fromTime: '14:00', toTime: '15:00' });
    expect(promotionActive(day, TUESDAY_1430, DAMASCUS)).toBe(true);
    expect(promotionActive(rule({ fromTime: '14:30', toTime: '14:31' }), TUESDAY_1430, DAMASCUS)).toBe(true);
    expect(promotionActive(rule({ fromTime: '13:00', toTime: '14:30' }), TUESDAY_1430, DAMASCUS)).toBe(false);
    const night = rule({ fromTime: '22:00', toTime: '02:00' });
    expect(promotionActive(night, TUESDAY_1430, DAMASCUS)).toBe(false);
    expect(promotionActive(night, new Date('2026-11-03T20:00:00Z'), DAMASCUS)).toBe(true);
    expect(promotionActive(night, new Date('2026-11-03T22:30:00Z'), DAMASCUS)).toBe(true);
    // Only one end set: no hour limit
    expect(promotionActive(rule({ fromTime: '22:00' }), TUESDAY_1430, DAMASCUS)).toBe(true);
  });

  it('never runs once stopped', () => {
    expect(promotionActive(rule({ archived: true }), TUESDAY_1430, DAMASCUS)).toBe(false);
  });
});

describe('promotionDiscount', () => {
  it('takes a percent off the line’s gross', () => {
    expect(promotionDiscount(rule({ percentBp: 1500 }), line())).toBe(4_500);
    expect(promotionDiscount(rule({ percentBp: 15_000 }), line())).toBe(30_000);
    expect(promotionDiscount(rule({ percentBp: 0 }), line())).toBe(0);
    expect(promotionDiscount(rule({ percentBp: null }), line())).toBe(0);
  });

  it('gives the free packs of buy-get, whole packs only and never on a weighed line', () => {
    const b2g1 = rule({ kind: 'buy_get', percentBp: null, buyQty: 2, getQty: 1 });
    expect(promotionDiscount(b2g1, line({ qty: 2000 }))).toBe(0);
    expect(promotionDiscount(b2g1, line({ qty: 3000 }))).toBe(10_000);
    expect(promotionDiscount(b2g1, line({ qty: 8500 }))).toBe(20_000);
    expect(promotionDiscount(b2g1, line({ qty: 9000, weighed: true }))).toBe(0);
    expect(promotionDiscount(rule({ kind: 'buy_get', buyQty: 0, getQty: 1 }), line())).toBe(0);
    expect(promotionDiscount(rule({ kind: 'buy_get', buyQty: 2, getQty: null }), line())).toBe(0);
    expect(promotionDiscount(rule({ kind: 'buy_get', buyQty: null, getQty: 1 }), line())).toBe(0);
  });

  it('applies to its products or categories only, a parent category reaching its children', () => {
    expect(promotionDiscount(rule({ scope: 'products', productIds: ['milk'] }), line())).toBe(3_000);
    expect(promotionDiscount(rule({ scope: 'products', productIds: ['rice'] }), line())).toBe(0);
    expect(promotionDiscount(rule({ scope: 'categories', categoryIds: ['food'] }), line())).toBe(3_000);
    expect(promotionDiscount(rule({ scope: 'categories', categoryIds: ['home'] }), line())).toBe(0);
    expect(promotionDiscount(rule({ scope: 'other' as never }), line())).toBe(0);
  });

  it('takes nothing off an empty or free line', () => {
    expect(promotionDiscount(rule(), line({ qty: 0 }))).toBe(0);
    expect(promotionDiscount(rule(), line({ unitPriceMinor: 0 }))).toBe(0);
  });
});

describe('bestPromotions', () => {
  it('gives each line its best promotion, the first listed on a tie, and leaves the others out', () => {
    const tenPercent = rule({ id: 'ten', name: 'خصم 10%' });
    const free = rule({ id: 'free', name: '2+1', kind: 'buy_get', buyQty: 2, getQty: 1 });
    const alsoTen = rule({ id: 'ten2', name: 'خصم آخر' });
    const rice = rule({ id: 'rice', scope: 'products', productIds: ['rice'], percentBp: 5000 });
    const result = bestPromotions(
      [line(), line({ lineNo: 2, qty: 1000 }), line({ lineNo: 3, productId: 'rice', categoryPath: [] })],
      [tenPercent, alsoTen, free, rice],
    );
    expect(result.get(1)).toEqual({ promotionId: 'free', name: '2+1', discountMinor: 10_000 });
    expect(result.get(2)).toEqual({ promotionId: 'ten', name: 'خصم 10%', discountMinor: 1_000 });
    expect(result.get(3)).toEqual({ promotionId: 'rice', name: 'عرض', discountMinor: 15_000 });
    expect(bestPromotions([line({ qty: 0 })], [tenPercent]).size).toBe(0);
  });
});
