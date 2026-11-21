import { describe, expect, it } from 'vitest';
import { CUSTOMER_KIND_LABELS, CUSTOMER_KINDS } from './customers';
import { ALL_PERMISSIONS, DEFAULT_ROLES } from '../permissions';
import {
  commissionPlanInput,
  DEFAULT_NO_SALE_REASONS,
  DISTRIBUTION_DEFAULTS,
  distributionSettingsOf,
  regionInput,
  repInput,
  repSettlementInput,
  repTargetInput,
  repUpdateInput,
  repVisitInput,
  routeCustomersInput,
  routeInput,
  salesOrderPayloadSchema,
  vanInput,
} from './distribution';

const id = (n: number) => `0192a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('distribution settings', () => {
  it('fills what the store never chose with the defaults, and ignores what is not valid', () => {
    expect(distributionSettingsOf(null)).toEqual(DISTRIBUTION_DEFAULTS);
    expect(distributionSettingsOf({ gps: true, orderHoldDays: 14 })).toEqual({
      ...DISTRIBUTION_DEFAULTS,
      gps: true,
      orderHoldDays: 14,
    });
    expect(distributionSettingsOf({ orderHoldDays: 0, gps: true })).toEqual(DISTRIBUTION_DEFAULTS);
  });

  it('starts every store with the same eight no-sale reasons, in order', () => {
    expect(DEFAULT_NO_SALE_REASONS.map((r) => r.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(DEFAULT_NO_SALE_REASONS.map((r) => r.key)).size).toBe(8);
  });
});

describe('customer kinds', () => {
  it('names every kind, the shops of a distributor included', () => {
    for (const kind of CUSTOMER_KINDS) expect(CUSTOMER_KIND_LABELS[kind], kind).toBeTruthy();
    expect(CUSTOMER_KINDS).toEqual(
      expect.arrayContaining(['grocery', 'minimarket', 'supermarket', 'restaurant', 'sub_wholesaler']),
    );
  });
});

describe('roles and permissions for the reps module', () => {
  const keys = [
    'rep.sell',
    'rep.order',
    'rep.collect',
    'rep.deliver',
    'rep.settle',
    'rep.track',
    'rep.targets',
    'routes.manage',
    'sales_orders.manage',
  ] as const;

  it('knows every key, gives the owner all of them and the manager all but the live location', () => {
    for (const key of keys) expect(ALL_PERMISSIONS, key).toContain(key);
    const owner = DEFAULT_ROLES.find((r) => r.key === 'owner')!;
    const manager = DEFAULT_ROLES.find((r) => r.key === 'manager')!;
    for (const key of keys) expect(owner.permissions).toContain(key);
    expect(manager.permissions).not.toContain('rep.track');
    for (const key of keys.filter((k) => k !== 'rep.track')) expect(manager.permissions).toContain(key);
  });

  it('adds the rep, the driver and the sales supervisor, and leaves the old roles as they were', () => {
    const byKey = Object.fromEntries(DEFAULT_ROLES.map((r) => [r.key, r.permissions]));
    expect(Object.keys(byKey)).toEqual([
      'owner',
      'manager',
      'cashier',
      'waiter',
      'pharmacist',
      'accountant',
      'storekeeper',
      'rep',
      'driver',
      'sales_supervisor',
    ]);
    expect(byKey.cashier).toEqual(['sale.create', 'sale.discount', 'shift.close_own', 'receipt.create']);
    expect(byKey.rep).toEqual(expect.arrayContaining(['rep.sell', 'rep.order', 'rep.collect']));
    expect(byKey.rep).not.toContain('routes.manage');
    expect(byKey.driver).toContain('rep.deliver');
    expect(byKey.sales_supervisor).toEqual(
      expect.arrayContaining(['routes.manage', 'rep.settle', 'rep.targets', 'sales_orders.manage']),
    );
    expect(byKey.sales_supervisor).not.toContain('rep.track');
  });
});

describe('setup inputs', () => {
  it('trims and requires names, and takes a region under another', () => {
    expect(regionInput.safeParse({ name: ' المزة ' }).data?.name).toBe('المزة');
    expect(regionInput.safeParse({ name: 'م' }).success).toBe(false);
    expect(regionInput.safeParse({ name: 'المزة', parentId: 'x' }).success).toBe(false);
    expect(vanInput.safeParse({ name: 'سيارة', parentBranchId: id(1), vehiclePlate: '' }).data).toEqual({
      name: 'سيارة',
      parentBranchId: id(1),
      vehiclePlate: null,
    });
  });

  it('keeps a rep to a known mode and bounded limits, and never lets his user change', () => {
    expect(repInput.safeParse({ userId: id(1), branchId: id(2) }).success).toBe(true);
    expect(repInput.safeParse({ userId: id(1), branchId: id(2), mode: 'both' }).success).toBe(true);
    expect(repInput.safeParse({ userId: id(1), branchId: id(2), mode: 'x' }).success).toBe(false);
    expect(repInput.safeParse({ userId: id(1), branchId: id(2), maxDiscountBp: 10_001 }).success).toBe(false);
    const update = repUpdateInput.safeParse({ branchId: id(2), version: 1, userId: id(9) });
    expect(update.success).toBe(true);
    expect(update.data).not.toHaveProperty('userId');
  });

  it('takes weekdays 0 to 6 and a list of customers with the version it was read at', () => {
    expect(routeInput.safeParse({ name: 'خط السبت', weekdays: [6, 0] }).success).toBe(true);
    expect(routeInput.safeParse({ name: 'خط', weekdays: [7] }).success).toBe(false);
    expect(routeCustomersInput.safeParse({ customerIds: [id(1), id(2)], version: 3 }).success).toBe(true);
    expect(routeCustomersInput.safeParse({ customerIds: [id(1)] }).success).toBe(false);
  });
});

describe('pre-sale order and the day', () => {
  const line = { variantId: id(1), qty: 2000, unitPriceMinor: 15_000 };
  const order = {
    customerId: id(2),
    warehouseBranchId: id(3),
    repId: null,
    currency: 'SYP',
    lines: [line],
    totalMinor: 30_000,
  };

  it('needs a line, and fills what a phone leaves out', () => {
    const parsed = salesOrderPayloadSchema.safeParse(order);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      depositMinor: 0,
      depositReceiptId: null,
      deliveryDate: null,
      note: null,
      lines: [{ ...line, deliveredQty: 0 }],
    });
    expect(salesOrderPayloadSchema.safeParse({ ...order, lines: [] }).success).toBe(false);
    expect(salesOrderPayloadSchema.safeParse({ ...order, lines: [{ ...line, qty: 0 }] }).success).toBe(false);
  });

  it('asks a no-sale visit for its reason, and a position for both coordinates', () => {
    const visit = {
      id: id(1),
      repDayId: id(2),
      customerId: id(3),
      arrivedAt: '2026-11-17T08:00:00+03:00',
    };
    expect(repVisitInput.safeParse(visit).data).toMatchObject({
      outcome: 'none',
      offRoute: false,
      docIds: [],
    });
    const noReason = repVisitInput.safeParse({ ...visit, outcome: 'no_sale' });
    expect(noReason.success).toBe(false);
    expect(repVisitInput.safeParse({ ...visit, outcome: 'no_sale', noSaleReasonId: id(4) }).success).toBe(
      true,
    );
    expect(repVisitInput.safeParse({ ...visit, lat: 33.5 }).success).toBe(false);
    expect(repVisitInput.safeParse({ ...visit, lat: 33.5, lng: 36.3 }).success).toBe(true);
    expect(repVisitInput.safeParse({ ...visit, lat: 100, lng: 36.3 }).success).toBe(false);
  });

  it('takes the supervisor’s count per currency and a known treatment', () => {
    const ok = { repId: id(1), businessDate: '2026-11-17', countedCash: { SYP: 2_185_000, USD: 0 } };
    expect(repSettlementInput.safeParse(ok).success).toBe(true);
    expect(repSettlementInput.safeParse({ ...ok, treatment: 'rep_debt' }).success).toBe(true);
    expect(repSettlementInput.safeParse({ ...ok, treatment: 'free' }).success).toBe(false);
    expect(repSettlementInput.safeParse({ ...ok, countedCash: { syp: 1 } }).success).toBe(false);
    expect(repSettlementInput.safeParse({ ...ok, countedCash: { SYP: -1 } }).success).toBe(false);
  });

  it('checks a target’s period and what it is counted over, and a commission plan’s rate or tiers', () => {
    const target = {
      repId: id(1),
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      metric: 'net_sales',
      targetValue: 10_000_000,
    };
    expect(repTargetInput.safeParse(target).success).toBe(true);
    expect(repTargetInput.safeParse({ ...target, periodEnd: '2026-10-31' }).success).toBe(false);
    expect(repTargetInput.safeParse({ ...target, scope: 'product' }).success).toBe(false);
    expect(repTargetInput.safeParse({ ...target, scope: 'product', productId: id(2) }).success).toBe(true);

    expect(commissionPlanInput.safeParse({ name: 'خطة', rateBp: 150 }).success).toBe(true);
    expect(commissionPlanInput.safeParse({ name: 'خطة' }).success).toBe(false);
    expect(commissionPlanInput.safeParse({ name: 'خطة', mode: 'tiered' }).success).toBe(false);
    expect(
      commissionPlanInput.safeParse({ name: 'خطة', mode: 'tiered', tiers: [{ fromMinor: 0, rateBp: 100 }] })
        .success,
    ).toBe(true);
  });
});
