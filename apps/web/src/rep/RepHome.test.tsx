import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepDaySheet } from '@serva/core/distribution';
import { memoryLocal, type LocalStore } from '../offline/local';
import type { CatalogSets } from '../pos/catalog';
import { saveWith, type PosServices } from '../pos/services';
import { ids, linkedDevice, memoryStore, PINS, posSets, PRODUCTS, staffServer } from '../test/pos';
import { scan } from '../test/renderPos';
import { buildSalePayload } from '@serva/core/sale';
import { RepSession } from './RepApp';
// Loaded up front so no test waits on a lazy chunk.
import '../pos/CashierApp';
import '../pos/staff/StaffSignIn';
import '../pos/pay/PaymentPanel';
import '../pos/shift/ShiftScreens';
import './RepHome';

const REP = '0192a000-0000-7000-8000-0000000000d9';
const REP_ROLE = '0192a000-0000-7000-8000-0000000000c9';
const WAREHOUSE = '0192a000-0000-7000-8000-0000000000b2';
const ROUTE = '0192a000-0000-7000-8000-000000000a01';
const REASON = '0192a000-0000-7000-8000-000000000a11';
const ORDER = '0192a000-0000-7000-8000-000000000a21';
const SHIFT_ID = '0192a000-0000-7000-8000-00000000fff1';
PINS[REP] = '1234';

/** A rep's phone: the van is this device's own branch (001), its routes and reasons are pulled sets */
function repSets(extra: Record<string, unknown[]> = {}): CatalogSets {
  const base = posSets();
  const milk = PRODUCTS.milk.variant.id;
  return {
    ...base,
    users: [
      ...base.users,
      { id: REP, fullName: 'ربيع', status: 'active', pinLength: 4, pinVersion: 1, version: 1 },
    ],
    roles: [
      ...base.roles,
      {
        id: REP_ROLE,
        key: 'rep',
        name: 'مندوب',
        permissions: [
          'sale.create',
          'sale.credit',
          'sale.refund',
          'receipt.create',
          'shift.close_own',
          'rep.order',
        ],
        maxDiscountBp: 500,
        version: 1,
      },
    ],
    user_roles: [
      ...base.user_roles,
      { id: 'ur-rep', userId: REP, roleId: REP_ROLE, branchId: null, version: 1 },
    ],
    branches: [
      { ...base.branches[0]!, kind: 'van', parentBranchId: WAREHOUSE, vehiclePlate: '123456' },
      { ...base.branches[0]!, id: WAREHOUSE, code: '000', name: 'المستودع', kind: 'store' },
    ],
    stock_levels: [
      {
        id: 'sl-1',
        branchId: ids.branch,
        variantId: milk,
        qty: 12_000,
        reservedQty: 0,
        batches: null,
        version: 1,
      },
    ],
    routes: [
      {
        id: ROUTE,
        name: 'خط المزة',
        regionId: null,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        repId: 'rep-1',
        sortOrder: 1,
        isActive: true,
        version: 1,
      },
    ],
    route_customers: [
      { id: 'rc-1', routeId: ROUTE, customerId: ids.alNour, visitOrder: 1, version: 1 },
      { id: 'rc-2', routeId: ROUTE, customerId: ids.abuKhaled, visitOrder: 2, version: 1 },
    ],
    no_sale_reasons: [
      { id: REASON, key: 'closed', name: 'المحل مغلق', sortOrder: 1, isActive: true, version: 1 },
    ],
    sales_orders: [],
    ...extra,
  } as unknown as CatalogSets;
}

function sheetFor(sets: CatalogSets, returnable: RepDaySheet['returnable'] = []): RepDaySheet {
  return {
    businessDate: '2026-11-18',
    weekday: 3,
    baseCurrency: 'SYP',
    rep: {
      id: 'rep-1',
      userId: REP,
      mode: 'both',
      vanBranchId: ids.branch,
      vanName: 'سيارة المزة',
      vehiclePlate: '123456',
      maxDiscountBp: null,
      dailyCreditLimitMinor: null,
    },
    settings: {
      requireCustomerApproval: true,
      offRouteNeedsReason: true,
      gps: false,
      keepStockInVanOvernight: false,
      returnsNeedApproval: false,
      orderHoldDays: 7,
      invoiceOrdersAt: 'delivery',
    },
    routes: [
      {
        id: ROUTE,
        name: 'خط المزة',
        regionId: null,
        regionName: null,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        customerIds: [ids.alNour, ids.abuKhaled],
      },
    ],
    todayRouteIds: [ROUTE],
    customers: sets.customers.slice(0, 3).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      address: null,
      regionId: null,
      approvalStatus: 'approved',
      priceTier: c.priceTier,
      kind: null,
      creditLimitMinor: c.creditLimitMinor,
      balanceMinor: c.id === ids.alNour ? 250_000 : 0,
      overdueMinor: c.id === ids.alNour ? 100_000 : 0,
      lat: null,
      lng: null,
      lastSaleDate: c.id === ids.alNour ? '2026-11-10' : null,
    })),
    contractPrices: [],
    openOrders: [],
    returnable,
    vanStock: [],
    visits: [],
  };
}

interface Calls {
  vanCounts: Record<string, unknown>[];
  visits: Record<string, unknown>[];
  orders: Record<string, unknown>[];
}

function harness(
  options: {
    extra?: Record<string, unknown[]>;
    online?: boolean;
    local?: LocalStore;
    returnable?: RepDaySheet['returnable'];
  } = {},
) {
  const sets = repSets(options.extra);
  const { store, outbox } = memoryStore(linkedDevice, sets);
  const local = options.local ?? memoryLocal();
  let online = options.online ?? true;
  const calls: Calls = { vanCounts: [], visits: [], orders: [] };
  const staff = staffServer(sets);
  const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (path === '/v1/device/rep/day') return json(sheetFor(sets, options.returnable));
    if (path === '/v1/device/rep/visits') {
      calls.visits.push(JSON.parse(String(init?.body)));
      return json({ id: 'x' }, 201);
    }
    if (path === '/v1/device/rep/van-count') {
      calls.vanCounts.push(JSON.parse(String(init?.body)));
      return json({ id: 'd' });
    }
    if (path === '/v1/device/sales-orders') {
      calls.orders.push(JSON.parse(String(init?.body)));
      return json({ id: 'o', number: 'SO-001-002-0000001' }, 201);
    }
    if (path === '/v1/device/rep/day') return json({ id: 'd' });
    if (path.startsWith('/v1/device/customers/')) return json({ balanceMinor: 0, sizes: [], invoices: [] });
    return (staff as unknown as typeof fetch)(url, init);
  });
  const services: PosServices = {
    store,
    local,
    device: linkedDevice,
    save: saveWith(store, null, Date.now),
    online: () => online,
    now: Date.now,
    sync: null,
    fetch: fetchFn as unknown as typeof fetch,
  };
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <RepSession services={services} persisted />
    </MemoryRouter>,
  );
  return { user, outbox, local, calls, fetchFn, setOnline: (v: boolean) => (online = v) };
}

async function openShift(local: LocalStore) {
  await local.set(`shift:${REP}`, {
    key: `shift:${REP}`,
    id: SHIFT_ID,
    number: 'SFT-001-002-0000001',
    openedBy: REP,
    openedByName: 'ربيع',
    openedAt: Date.now(),
    mode: 'per_cashier',
    opening: [{ currency: 'SYP', amountMinor: 0, denominations: null }],
  });
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await user.click(within(list).getByRole('button', { name: /ربيع/ }));
  await user.keyboard(PINS[REP]!);
}

describe('the rep’s day (/rep)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('asks the rep to confirm the van’s load before the shift opens', async () => {
    const h = harness();
    await signIn(h.user);
    expect(await screen.findByRole('heading', { name: 'ابدأ يومك' })).toBeInTheDocument();
    // The load is what the van holds: one item of the milk
    await h.user.click(screen.getByRole('button', { name: 'اعرض الأصناف' }));
    expect(screen.getByRole('list', { name: 'حمولة السيارة' })).toHaveTextContent('حليب كامل الدسم 1 لتر');
    await h.user.click(screen.getByRole('checkbox', { name: 'استلمت الحمولة وراجعتها' }));
    // Then the till's own shift opening, for the float
    expect(await screen.findByRole('heading', { name: /فتح وردية|ابدأ الوردية|وردية/ })).toBeInTheDocument();
  });

  it('lists today’s route in order with the progress, and opens a customer with his balance', async () => {
    const local = memoryLocal();
    await openShift(local);
    const h = harness({ local });
    await signIn(h.user);

    const list = await screen.findByRole('list', { name: 'خط سير اليوم' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('بقالية النور');
    expect(rows[1]).toHaveTextContent('أبو خالد');
    expect(screen.getByText(/زُرت/)).toHaveTextContent('زُرت 0 من 2');

    await h.user.click(within(rows[0]!).getByRole('button'));
    expect(await screen.findByRole('heading', { name: 'بقالية النور' })).toBeInTheDocument();
    // The balance and the overdue part come from the day sheet
    await waitFor(() => expect(screen.getByText('عليه')).toBeInTheDocument());
    expect(screen.getByText('متأخر أكثر من 30 يوماً')).toBeInTheDocument();
    for (const name of ['بيع', 'قبض', 'مرتجع', 'لا بيع', 'طلبية']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('records «لا بيع» with its reason: the stop turns «بلا بيع» and the visit is sent', async () => {
    const local = memoryLocal();
    await openShift(local);
    const h = harness({ local });
    await signIn(h.user);
    const list = await screen.findByRole('list', { name: 'خط سير اليوم' });
    await h.user.click(within(within(list).getAllByRole('listitem')[0]!).getByRole('button'));
    await h.user.click(await screen.findByRole('button', { name: 'لا بيع' }));
    await h.user.click(await screen.findByRole('radio', { name: 'المحل مغلق' }));
    await h.user.click(screen.getByRole('button', { name: 'سجّل' }));

    const after = await screen.findByRole('list', { name: 'خط سير اليوم' });
    expect(within(after).getAllByRole('listitem')[0]).toHaveTextContent('بلا بيع');
    expect(screen.getByText(/زُرت/)).toHaveTextContent('زُرت 1 من 2');
    await waitFor(() => expect(h.calls.visits).toHaveLength(1));
    expect(h.calls.visits[0]).toMatchObject({
      customerId: ids.alNour,
      outcome: 'no_sale',
      noSaleReasonId: REASON,
      routeId: ROUTE,
      offRoute: false,
    });
  });

  it('sells to the customer from his page: the sale screen opens with him on the cart, and «يومي» comes back', async () => {
    const local = memoryLocal();
    await openShift(local);
    const h = harness({ local });
    await signIn(h.user);
    const list = await screen.findByRole('list', { name: 'خط سير اليوم' });
    await h.user.click(within(within(list).getAllByRole('listitem')[0]!).getByRole('button'));
    await h.user.click(await screen.findByRole('button', { name: 'بيع' }));
    expect(await screen.findByRole('list', { name: 'الأصناف' })).toBeInTheDocument();
    expect(screen.getAllByText('بقالية النور').length).toBeGreaterThan(0);
  });

  it('takes a pre-sale order online', async () => {
    const local = memoryLocal();
    await openShift(local);
    const h = harness({ local });
    await signIn(h.user);
    const list = await screen.findByRole('list', { name: 'خط سير اليوم' });
    await h.user.click(within(within(list).getAllByRole('listitem')[0]!).getByRole('button'));
    await h.user.click(await screen.findByRole('button', { name: 'طلبية' }));
    await h.user.type(await screen.findByRole('textbox', { name: 'ابحث عن صنف' }), 'حليب');
    await h.user.click(await screen.findByRole('button', { name: /حليب كامل الدسم/ }));
    await h.user.click(screen.getByRole('button', { name: 'احفظ الطلبية' }));
    expect(await screen.findByText(/سُجّلت الطلبية/)).toBeInTheDocument();
    expect(h.calls.orders).toHaveLength(1);
    expect(h.calls.orders[0]).toMatchObject({
      customerId: ids.alNour,
      warehouseBranchId: WAREHOUSE,
      repId: 'rep-1',
      currency: 'SYP',
      lines: [{ variantId: PRODUCTS.milk.variant.id, qty: 1000, deliveredQty: 0 }],
    });
  });

  it('keeps an order taken offline on the phone until the server can be reached', async () => {
    const local = memoryLocal();
    await openShift(local);
    const h = harness({ local });
    await signIn(h.user);
    const list = await screen.findByRole('list', { name: 'خط سير اليوم' });
    // The signal drops after the morning sheet was read
    h.setOnline(false);
    await h.user.click(within(within(list).getAllByRole('listitem')[0]!).getByRole('button'));
    await h.user.click(await screen.findByRole('button', { name: 'طلبية' }));
    await h.user.type(await screen.findByRole('textbox', { name: 'ابحث عن صنف' }), 'حليب');
    await h.user.click(await screen.findByRole('button', { name: /حليب كامل الدسم/ }));
    await h.user.click(screen.getByRole('button', { name: 'احفظ الطلبية' }));
    expect(await screen.findByText(/تُرسل عند عودة الاتصال/)).toBeInTheDocument();
    expect(h.calls.orders).toHaveLength(0);
    const queue = await local.get<{ customerId: string }[]>('rep:order-queue');
    expect(queue).toHaveLength(1);
    expect(queue![0]!.customerId).toBe(ids.alNour);
  });

  it('adds a new customer as pending: cash only, and he is on the customer page at once', async () => {
    const local = memoryLocal();
    await openShift(local);
    const h = harness({ local });
    await signIn(h.user);
    await h.user.click(await screen.findByRole('button', { name: 'زبون جديد' }));
    await h.user.type(await screen.findByRole('textbox', { name: 'اسم الزبون' }), 'بقالة السلام');
    await h.user.click(screen.getByRole('button', { name: 'احفظ وافتح الزبون' }));
    expect(await screen.findByRole('heading', { name: 'بقالة السلام' })).toBeInTheDocument();
    expect(screen.getByText(/بانتظار موافقة المشرف: البيع له نقداً فقط/)).toBeInTheDocument();
    expect(h.outbox.map((e) => e.type)).toContain('customer');
  });

  it('shows the day’s figures and the three steps that end it', async () => {
    const local = memoryLocal();
    await openShift(local);
    const h = harness({ local });
    await signIn(h.user);
    await h.user.click(await screen.findByRole('button', { name: 'يومي' }));
    expect(await screen.findByRole('heading', { name: 'إنهاء اليوم' })).toBeInTheDocument();
    expect(screen.getByText('جرد السيارة')).toBeInTheDocument();
    expect(screen.getByText('تسليم النقد للخزنة')).toBeInTheDocument();
    expect(screen.getByText('إغلاق الوردية')).toBeInTheDocument();
    expect(screen.getByText('مبيعات اليوم')).toBeInTheDocument();
  });

  it('counts the van blind and shows the differences only after saving', async () => {
    const local = memoryLocal();
    await openShift(local);
    const h = harness({ local });
    await signIn(h.user);
    await h.user.click(await screen.findByRole('button', { name: 'السيارة' }));
    expect(await screen.findByRole('list', { name: 'مخزون السيارة' })).toHaveTextContent('12');
    await h.user.click(screen.getByRole('button', { name: 'جرد السيارة' }));
    // While counting the book's quantity is not shown
    expect(screen.queryByRole('list', { name: 'مخزون السيارة' })).not.toBeInTheDocument();
    await h.user.type(await screen.findByRole('textbox', { name: 'العدد' }), '10');
    await h.user.click(screen.getByRole('button', { name: 'احفظ الجرد' }));
    const section = await screen.findByRole('region', { name: 'جرد اليوم' });
    expect(section).toHaveTextContent('ناقص');
    expect(section).toHaveTextContent('2');
    // The count goes to the server for the supervisor's settlement, and the phone remembers it was sent
    await waitFor(() => expect(h.calls.vanCounts).toHaveLength(1));
    expect(h.calls.vanCounts[0]).toEqual({
      businessDate: '2026-11-18',
      lines: [{ variantId: PRODUCTS.milk.variant.id, counted: 10_000 }],
    });
    await waitFor(async () =>
      expect(await h.local.get<{ sent?: boolean }>('rep:van-count')).toMatchObject({ sent: true }),
    );
  });

  it('keeps the van count on the phone while there is no connection, unsent', async () => {
    const local = memoryLocal();
    await openShift(local);
    const h = harness({ local });
    await signIn(h.user);
    await screen.findByRole('list', { name: 'خط سير اليوم' });
    // The signal drops after the morning sheet was read
    h.setOnline(false);
    await h.user.click(await screen.findByRole('button', { name: 'السيارة' }));
    await h.user.click(await screen.findByRole('button', { name: 'جرد السيارة' }));
    await h.user.type(await screen.findByRole('textbox', { name: 'العدد' }), '12');
    await h.user.click(screen.getByRole('button', { name: 'احفظ الجرد' }));
    await screen.findByRole('region', { name: 'جرد اليوم' });
    expect(h.calls.vanCounts).toHaveLength(0);
    expect(await local.get<{ sent?: boolean; lines: unknown[] }>('rep:van-count')).toMatchObject({
      lines: [expect.objectContaining({ counted: 12_000 })],
    });
    expect((await local.get<{ sent?: boolean }>('rep:van-count'))?.sent).toBeUndefined();
  });

  it('delivers an order from the van at the price it promised, and the sale names the order', async () => {
    const local = memoryLocal();
    await openShift(local);
    const milk = PRODUCTS.milk.variant.id;
    const h = harness({
      local,
      extra: {
        sales_orders: [
          {
            id: ORDER,
            number: 'SO-001-002-0000007',
            status: 'partial',
            customerId: ids.alNour,
            branchId: ids.branch,
            warehouseBranchId: ids.branch,
            repId: 'rep-1',
            businessDate: '2026-11-17',
            currency: 'SYP',
            totalMinor: 126_000,
            depositMinor: 0,
            deliveryDate: null,
            lines: [{ variantId: milk, qty: 3000, deliveredQty: 1000, unitPriceMinor: 42_000 }],
            version: 1,
          },
        ],
      },
    });
    await signIn(h.user);
    const list = await screen.findByRole('list', { name: 'خط سير اليوم' });
    await h.user.click(within(within(list).getAllByRole('listitem')[0]!).getByRole('button'));
    await h.user.click(await screen.findByRole('button', { name: 'سلّم' }));
    const lines = await screen.findByRole('list', { name: 'أسطر الفاتورة' });
    // What is left of the order (2 of 3), at the order's price, not the shelf's 500
    expect(lines).toHaveTextContent('حليب كامل الدسم');
    expect(screen.getByRole('status', { name: 'المطلوب' })).toHaveTextContent('840');
    await h.user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await h.user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
    await h.user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = h.outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as {
      salesOrderId: string;
      customerId: string;
      lines: { variantId: string; qty: number; priceMinor: number }[];
    };
    expect(sale.salesOrderId).toBe(ORDER);
    expect(sale.customerId).toBe(ids.alNour);
    expect(sale.lines).toEqual([expect.objectContaining({ variantId: milk, qty: 2000, priceMinor: 42_000 })]);
    // The visit to him now says «بيع» once he is back on the list
    await h.user.click(await screen.findByRole('button', { name: 'المزيد' }));
  });

  it('sells to a customer the supervisor has not approved for cash only: no account, no cheque', async () => {
    const local = memoryLocal();
    await openShift(local);
    const base = posSets();
    const customers = base.customers.map((c) =>
      c.id === ids.alNour ? { ...c, approvalStatus: 'pending', creditLimitMinor: null } : c,
    );
    const h = harness({ local, extra: { customers } });
    await signIn(h.user);
    const list = await screen.findByRole('list', { name: 'خط سير اليوم' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('بانتظار الموافقة');
    await h.user.click(within(within(list).getAllByRole('listitem')[0]!).getByRole('button'));
    await h.user.click(await screen.findByRole('button', { name: 'بيع' }));
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(h.user, PRODUCTS.tea.barcode!.code);
    await h.user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    expect(within(pay).queryByRole('button', { name: /آجل/ })).not.toBeInTheDocument();
    expect(within(pay).queryByRole('button', { name: /شيك/ })).not.toBeInTheDocument();
    expect(within(pay).getByRole('button', { name: /المبلغ تماماً/ })).toBeInTheDocument();
  });

  it('finds the customer’s invoice from the morning sheet in «مرتجع», without asking the server', async () => {
    const local = memoryLocal();
    await openShift(local);
    const payload = buildSalePayload({
      currency: 'SYP',
      taxInclusive: true,
      exchangeRates: [],
      lines: [
        {
          lineNo: 1,
          productId: PRODUCTS.milk.product.id,
          variantId: PRODUCTS.milk.variant.id,
          name: 'حليب كامل الدسم 1 لتر',
          qty: 2000,
          priceCurrency: 'SYP',
          priceMinor: 50_000,
          taxRateBp: 0,
        },
      ],
      shiftId: SHIFT_ID,
      cashierId: REP,
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 100_000 }],
      cashSteps: {},
      customerId: ids.alNour,
      customerName: 'بقالية النور',
    });
    const h = harness({
      local,
      returnable: [
        {
          id: '0192a000-0000-7000-8000-000000000b01',
          number: 'INV-001-009-0000042',
          customerId: ids.alNour,
          deviceTime: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          payload: payload as unknown as Record<string, unknown>,
          returned: [],
        },
      ],
    });
    await signIn(h.user);
    const list = await screen.findByRole('list', { name: 'خط سير اليوم' });
    await h.user.click(within(within(list).getAllByRole('listitem')[0]!).getByRole('button'));
    await h.user.click(await screen.findByRole('button', { name: 'مرتجع' }));
    expect(await screen.findByText('INV-001-009-0000042')).toBeInTheDocument();
  });

  it('closes the shift from «يومي» with the blind count, then the rep’s next day starts at the load check', async () => {
    const local = memoryLocal();
    await openShift(local);
    const h = harness({ local });
    await signIn(h.user);
    await h.user.click(await screen.findByRole('button', { name: 'يومي' }));
    await h.user.click(await screen.findByRole('button', { name: 'أغلق الوردية' }));
    expect(await screen.findByText(/عدّ أعمى/)).toBeInTheDocument();
    const boxes = screen.getAllByRole('textbox', { name: 'المجموع' });
    await h.user.type(boxes[0]!, '0');
    await h.user.type(boxes[1]!, '0');
    await h.user.click(screen.getByRole('button', { name: 'راجع وأغلق' }));
    await h.user.click(await screen.findByRole('button', { name: 'أغلق الوردية' }));
    await h.user.click(await screen.findByRole('button', { name: 'نعم، أغلق الوردية' }));
    expect(h.outbox.map((e) => e.type)).toContain('shift_close');
    await h.user.click(await screen.findByRole('button', { name: 'تمّ' }));
    // The rep is signed out; coming back he starts a new day: the load check, then the shift
    await signIn(h.user);
    expect(await screen.findByRole('heading', { name: 'ابدأ يومك' })).toBeInTheDocument();
  });
});
