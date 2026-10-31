import type { PullSetRows } from '@serva/core/contracts/catalog';
import { formatDocNumber, payloadHash, seriesOf, CONTRACT_VERSION, documentBytes } from '@serva/sync';
import type { OutboxEntry } from '@serva/sync';
import type { DeviceRecord, NewDocument, SyncStore } from '@serva/sync/client';
import { EMPTY_META } from '@serva/sync/client';
import { vi } from 'vitest';
import type { CatalogSets } from '../pos/catalog';
import type { StaffSessionResponse } from '../pos/staff/staffApi';

/**
 * A Raqqa supermarket on a cashier device: the pull sets as the server sends them (17 › السحب),
 * the staff with their codes, and an in-memory sync store for the screens' flow tests.
 */

export const ids = {
  tenant: '0192a000-0000-7000-8000-0000000000aa',
  branch: '0192a000-0000-7000-8000-0000000000b1',
  cashierRole: '0192a000-0000-7000-8000-0000000000c1',
  managerRole: '0192a000-0000-7000-8000-0000000000c2',
  samer: '0192a000-0000-7000-8000-0000000000d1',
  maryam: '0192a000-0000-7000-8000-0000000000d2',
  piece: '0192a000-0000-7000-8000-0000000000e1',
  kilo: '0192a000-0000-7000-8000-0000000000e2',
  dairy: '0192a000-0000-7000-8000-0000000000f1',
  grocery: '0192a000-0000-7000-8000-0000000000f2',
};

/** The codes each person types (the server's side of the fake). */
export const PINS: Record<string, string> = { [ids.samer]: '2580', [ids.maryam]: '147258' };

export const linkedDevice: DeviceRecord = {
  storeName: 'سوبرماركت الفرات',
  branchName: 'فرع دوار النعيم',
  deviceName: 'الصندوق 2',
  deviceId: '0192a000-0000-7000-8000-000000000002',
  token: `sdt_${'a'.repeat(43)}`,
  branchCode: '001',
  deviceCode: '002',
  sets: [],
};

let n = 0;
const id = () => `0192a000-0000-7000-8000-${String(++n).padStart(12, '0')}`;

/** One product with one variant, its price and barcode. */
function product(
  nameAr: string,
  priceMinor: number,
  barcode: string | null,
  options: { categoryId?: string; unitId?: string; currency?: 'SYP' | 'USD'; minPriceMinor?: number } = {},
) {
  const productId = id();
  const variantId = id();
  return {
    product: {
      id: productId,
      nameAr,
      nameEn: null,
      categoryId: options.categoryId ?? ids.grocery,
      brand: null,
      type: 'stock',
      status: 'active',
      unitId: options.unitId ?? ids.piece,
      taxRateId: null,
      sellOnPos: true,
      archived: false,
      version: 1,
    } satisfies PullSetRows['products'],
    variant: {
      id: variantId,
      productId,
      sku: null,
      label: null,
      attributes: [],
      sortOrder: 0,
      archived: false,
      version: 1,
    } satisfies PullSetRows['variants'],
    price: {
      id: variantId,
      variantId,
      currency: options.currency ?? 'SYP',
      priceMinor,
      minPriceMinor: options.minPriceMinor ?? null,
      priceChangedAt: '2026-10-01T08:00:00.000Z',
      version: 1,
    } satisfies PullSetRows['prices'],
    barcode: barcode
      ? ({
          id: id(),
          variantId,
          code: barcode,
          kind: 'standard',
          packQty: 1000,
          packName: null,
          packPriceMinor: null,
          version: 1,
        } satisfies PullSetRows['barcodes'])
      : null,
  };
}

export const PRODUCTS = {
  milk: product('حليب كامل الدسم 1 لتر', 50_000, '6291001000011', {
    categoryId: ids.dairy,
    minPriceMinor: 45_000,
  }),
  sugar: product('سكر أبيض 1 كغ', 79_000, '6291001000028'),
  oil: product('زيت دوار الشمس 1 لتر', 25_000, '6291001000035'),
  labneh: product('لبنة 1 كغ', 28_000, '6291001000042', { categoryId: ids.dairy }),
  tea: product('شاي أحمر 400 غ', 35_000, '6291001000059'),
  olives: product('زيتون أخضر', 30_000, null, { unitId: ids.kilo }),
  nescafe: product('نسكافيه غولد 200 غ', 1_500, '7613036000014', { currency: 'USD' }),
};

export function posSets(overrides: Partial<CatalogSets> = {}): CatalogSets {
  const list = Object.values(PRODUCTS);
  return {
    products: list.map((p) => p.product),
    variants: list.map((p) => p.variant),
    prices: list.map((p) => p.price),
    barcodes: list.flatMap((p) => (p.barcode ? [p.barcode] : [])),
    categories: [
      { id: ids.dairy, name: 'ألبان وأجبان', parentId: null, sortOrder: 1, archived: false, version: 1 },
      { id: ids.grocery, name: 'مواد غذائية', parentId: null, sortOrder: 2, archived: false, version: 1 },
    ],
    units: [
      { id: ids.piece, name: 'قطعة', symbol: 'قطعة', allowsFraction: false, version: 1 },
      { id: ids.kilo, name: 'كيلو', symbol: 'كغ', allowsFraction: true, version: 1 },
    ],
    tax_rates: [],
    stock_levels: [],
    exchange_rates: [
      {
        id: id(),
        unit: 'USD',
        quote: 'SYP',
        rate: '130',
        collectRate: null,
        minRate: null,
        maxRate: null,
        effectiveAt: '2026-10-01T06:00:00.000Z',
        version: 1,
      },
    ],
    settings: [
      {
        id: ids.tenant,
        baseCurrency: 'SYP',
        enabledCurrencies: ['SYP', 'USD'],
        taxInclusive: true,
        defaultTaxRateBp: 0,
        cashRoundingSteps: {},
        numberFormat: 'latn',
        receiptFooter: 'الاستبدال خلال 7 أيام بالإيصال.',
        storeName: 'سوبرماركت الفرات',
        taxNumber: '41875520',
        timezone: 'Asia/Damascus',
        businessDayCutoff: '00:00',
        shiftMode: 'per_cashier',
        version: 1,
      },
    ],
    users: [
      { id: ids.samer, fullName: 'سامر', status: 'active', pinLength: 4, pinVersion: 1, version: 1 },
      { id: ids.maryam, fullName: 'مريم', status: 'active', pinLength: 6, pinVersion: 1, version: 1 },
    ],
    roles: [
      {
        id: ids.cashierRole,
        key: 'cashier',
        name: 'كاشير',
        permissions: ['sale.create', 'sale.discount', 'shift.close_own'],
        maxDiscountBp: 1000,
        version: 1,
      },
      {
        id: ids.managerRole,
        key: 'manager',
        name: 'مديرة الفرع',
        permissions: [
          'sale.create',
          'sale.discount',
          'sale.discount_over_limit',
          'cash.move',
          'shift.close_own',
          'shift.close_any',
          'shift.view_difference',
        ],
        maxDiscountBp: 10000,
        version: 1,
      },
    ],
    user_roles: [
      { id: id(), userId: ids.samer, roleId: ids.cashierRole, branchId: ids.branch, version: 1 },
      { id: id(), userId: ids.maryam, roleId: ids.managerRole, branchId: null, version: 1 },
    ],
    branches: [
      {
        id: ids.branch,
        code: '001',
        name: 'فرع دوار النعيم',
        address: 'الرقة، حي النعيم',
        phone: '0944 123 456',
        isActive: true,
        version: 1,
      },
    ],
    ...overrides,
  };
}

/** The server's POST /v1/device/staff-sessions, with its lockout left out. */
export function staffServer(sets: CatalogSets = posSets()) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) !== '/v1/device/staff-sessions') throw new TypeError('Failed to fetch');
    const body = JSON.parse(String(init?.body)) as { userId: string; pin: string };
    const user = sets.users.find((u) => u.id === body.userId);
    if (!user || PINS[user.id] !== body.pin) {
      return new Response(JSON.stringify({ error: { code: 'pin_invalid', message: 'رمز غير صحيح' } }), {
        status: 401,
      });
    }
    const roleIds = sets.user_roles.filter((ur) => ur.userId === user.id).map((ur) => ur.roleId);
    const roles = sets.roles.filter((r) => roleIds.includes(r.id));
    const answer: StaffSessionResponse = {
      userId: user.id,
      fullName: user.fullName,
      roles: roles.map((r) => ({ key: r.key, name: r.name, branchId: null })),
      permissions: [...new Set(roles.flatMap((r) => r.permissions))],
      pinVersion: user.pinVersion,
      pinLength: user.pinLength!,
    };
    return new Response(JSON.stringify(answer), { status: 200 });
  });
}

/**
 * A SyncStore in memory: pulled sets, an outbox numbered per series exactly like the Dexie store
 * (INV-<branch>-<device>-<seq>), and nothing sent.
 */
export function memoryStore(device: DeviceRecord = linkedDevice, sets: CatalogSets = posSets()) {
  const outbox: OutboxEntry[] = [];
  const counters = new Map<string, number>();
  const store: SyncStore = {
    getDevice: async () => device,
    putDevice: async () => undefined,
    getDeviceKeys: async () => null,
    putDeviceKeys: async () => undefined,
    async createDocument(input: NewDocument, context) {
      const series = seriesOf(input.type);
      let number: string | null = null;
      if (series) {
        const sequence = (counters.get(series) ?? 0) + 1;
        counters.set(series, sequence);
        number = formatDocNumber({
          series,
          branchCode: device.branchCode!,
          deviceCode: device.deviceCode!,
          sequence,
        });
      }
      const body = {
        id: context.newId(),
        seq: outbox.length + 1,
        type: input.type,
        number,
        deviceTime: new Date(context.now).toISOString(),
        businessDate: input.businessDate,
        deviceOffsetMs: 0,
        engineVersion: input.engineVersion,
        contractVersion: CONTRACT_VERSION,
        deps: input.deps ?? [],
        payload: input.payload,
      };
      const doc = { ...body, hash: payloadHash(body) };
      const entry: OutboxEntry = {
        seq: body.seq,
        id: doc.id,
        type: doc.type,
        bytes: documentBytes(doc),
        doc,
        status: 'pending',
        attempts: 0,
        lastError: null,
        flags: [],
        createdAt: context.now,
        confirmedAt: null,
      };
      outbox.push(entry);
      return entry;
    },
    listPending: async () => outbox.filter((e) => e.status === 'pending'),
    listByStatus: async (status) => outbox.filter((e) => e.status === status),
    heldIds: async () => new Set(),
    recordResults: async () => undefined,
    recordAttempt: async () => undefined,
    maxConfirmedSeq: async () => 0,
    requeueConfirmed: async () => 0,
    pruneConfirmed: async () => 0,
    lastIssued: async () => ({}),
    countPending: async () => outbox.filter((e) => e.status === 'pending').length,
    getMeta: async () => EMPTY_META,
    setMeta: async () => undefined,
    restartAfterRestore: async () => ({ requeued: 0 }),
    getCursors: async () => ({}),
    applyPullPage: async () => undefined,
    resetSets: async () => undefined,
    applySnapshot: async () => undefined,
    readSet: async (set) => ((sets as unknown as Record<string, unknown[]>)[set] ?? []) as never,
  };
  return { store, outbox };
}
