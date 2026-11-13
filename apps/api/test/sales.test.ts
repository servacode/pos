import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildReturnPayload,
  type ReturnedLine,
  type SaleDetail,
  type SaleListPage,
  type SalePayload,
} from '@serva/core';
import { createDb } from '@serva/db';
import { TEST_APP_URL } from './urls';
import { payloadHash, type SyncDocument } from '@serva/sync';
import {
  cartLine,
  documents,
  goldenFirstSale,
  openStore,
  push,
  sale,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { createDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser } from './staff';

/** The invoice list and one invoice (contracts/sales.ts), read from what the tills synced. */

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

const get = (token: string, url: string) => app.inject({ method: 'GET', url, headers: bearer(token) });
const list = async (token: string, query = '') => {
  const res = await get(token, `/v1/sales${query ? `?${query}` : ''}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<SaleListPage>();
};

const asTestStore = (store: Store) => ({
  tenantId: store.tenantId,
  userId: store.userId,
  accessToken: store.accessToken,
  branchId: store.device.branchId,
});

async function personWith(store: Store, permissions: string[], phone: string, branchId?: string) {
  const key = `custom_${phone.slice(-4)}`;
  await ownerDb()`
    insert into roles (tenant_id, key, name, permissions, max_discount_bp, is_system)
    values (${store.tenantId}, ${key}, 'دور تجريبي', ${permissions}, 0, false)`;
  return staffUser(app, asTestStore(store), key, phone, { branchId, fullName: 'مراقب' });
}

interface Day {
  store: Store;
  doc: ReturnType<typeof documents>;
  open: SyncDocument;
  golden: SyncDocument;
  card: SyncDocument;
  cardPayload: SalePayload;
  cheap: SyncDocument;
  customerId: string;
}

/** Three sales on one device on 30 Oct: the golden cash one, a card one for «ريم», and a small one. */
async function aDay(store: Store): Promise<Day> {
  const customer = (
    await app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: bearer(store.accessToken),
      payload: { name: 'ريم' },
    })
  ).json<{ id: string }>();
  const doc = documents(store.device);
  const open = doc('shift_open', shiftOpen(store.userId));
  const golden = doc('sale', goldenFirstSale(store, open.id));
  const cardPayload = sale(store, open.id, {
    customerId: customer.id,
    customerName: 'ريم',
    lines: [cartLine(1, 200_000, { name: 'قميص', qty: 2000 })],
    payments: [
      { method: 'card', currency: 'SYP', amountMinor: 400_000, reference: '731205', cardLast4: '4821' },
    ],
  });
  const card = doc('sale', cardPayload);
  const cheap = doc(
    'sale',
    sale(store, open.id, {
      lines: [cartLine(1, 5_000, { name: 'علكة' })],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 5_000 }],
    }),
  );
  await push(app, store.device, [open, golden, card, cheap]);
  return { store, doc, open, golden, card, cardPayload, cheap, customerId: customer.id };
}

function returnOf(store: Store, day: Day, qty: number, returned: ReturnedLine[] = []) {
  const doc = day.doc;
  const payload = buildReturnPayload({
    sale: day.cardPayload,
    saleId: day.card.id,
    saleNumber: day.card.number!,
    shiftId: day.open.id,
    cashierId: store.userId,
    reason: 'مقاس خاطئ',
    picks: [{ saleLineNo: 1, qty }],
    returned,
    reference: 'R-1',
  });
  const { hash: _hash, ...body } = doc('return', payload);
  const withDeps = { ...body, deps: [day.card.id] };
  return { ...withDeps, hash: payloadHash(withDeps) };
}

describe('GET /v1/sales', () => {
  it('lists the store’s invoices newest first with their method, customer and status', async () => {
    const store = await openStore(app);
    const day = await aDay(store);
    const page = await list(store.accessToken);
    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(3);
    const byNumber = new Map(page.items.map((i) => [i.number, i]));
    expect(byNumber.get(day.card.number!)).toMatchObject({
      id: day.card.id,
      branchId: store.device.branchId,
      deviceCode: store.device.code,
      businessDate: '2026-10-30',
      cashier: { id: store.userId, fullName: 'أحمد الخطيب' },
      customer: { id: day.customerId, name: 'ريم' },
      currency: 'SYP',
      totalMinor: 400_000,
      methods: ['card'],
      returnedMinor: 0,
      status: 'paid',
    });
    expect(byNumber.get(day.golden.number!)).toMatchObject({ methods: ['cash'], customer: null });
  });

  it('filters by number or customer text, payment method, amount range and customer', async () => {
    const store = await openStore(app);
    const day = await aDay(store);
    const numbers = async (query: string) =>
      (await list(store.accessToken, query)).items.map((i) => i.number);
    expect(await numbers(`q=${encodeURIComponent(day.cheap.number!)}`)).toEqual([day.cheap.number]);
    expect(await numbers(`q=${encodeURIComponent('ريم')}`)).toEqual([day.card.number]);
    expect(await numbers('q=%25')).toEqual([]);
    expect(await numbers('method=card')).toEqual([day.card.number]);
    expect((await numbers('method=cash')).sort()).toEqual([day.golden.number, day.cheap.number].sort());
    expect(await numbers('method=voucher')).toEqual([]);
    expect(await numbers('minTotal=300000')).toEqual([day.card.number]);
    expect(await numbers('maxTotal=10000')).toEqual([day.cheap.number]);
    expect(await numbers(`customerId=${day.customerId}`)).toEqual([day.card.number]);
    expect(await numbers(`cashierId=${store.userId}`)).toHaveLength(3);
    expect(await numbers(`cashierId=${store.device.deviceId}`)).toEqual([]);
    expect((await get(store.accessToken, '/v1/sales?minTotal=10&maxTotal=5')).statusCode).toBe(400);
  });

  it('filters by business date range and by device', async () => {
    const store = await openStore(app);
    const day = await aDay(store);
    const next = await createDevice(store.tenantId);
    const tomorrow = documents(next, '2026-10-31');
    const open2 = tomorrow('shift_open', shiftOpen(store.userId));
    const later = tomorrow(
      'sale',
      sale(store, open2.id, {
        lines: [cartLine(1, 7_000)],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 7_000 }],
      }),
    );
    await push(app, next, [open2, later]);
    expect((await list(store.accessToken, 'from=2026-10-31')).items.map((i) => i.number)).toEqual([
      later.number,
    ]);
    expect((await list(store.accessToken, 'to=2026-10-30')).items).toHaveLength(3);
    expect((await list(store.accessToken, 'from=2026-10-01&to=2026-10-31')).items).toHaveLength(4);
    expect((await list(store.accessToken, `deviceId=${next.deviceId}`)).items.map((i) => i.number)).toEqual([
      later.number,
    ]);
    expect((await list(store.accessToken, `deviceId=${store.device.deviceId}`)).items).toHaveLength(3);
    expect(day.open.number).toBeTruthy();
  });

  it('pages by keyset without a gap or a repeat, newest first', async () => {
    const store = await openStore(app);
    await aDay(store);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: SaleListPage = await list(store.accessToken, `limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 5);
    expect(pages).toBe(2);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
    const all = await list(store.accessToken);
    expect(seen).toEqual(all.items.map((i) => i.id));
    expect((await get(store.accessToken, '/v1/sales?cursor=garbage')).statusCode).toBe(400);
  });

  it('pages whatever time zone the database session runs in', async () => {
    const store = await openStore(app);
    await aDay(store);
    // This app's connections run in Damascus time (+03), so device_time::text would say "+03".
    const damascus = createDb(TEST_APP_URL, { max: 2, timeouts: { TimeZone: 'Asia/Damascus' } });
    const apart = await makeApp({}, { database: damascus });
    try {
      const [row] = await damascus.client<{ tz: string }[]>`select current_setting('TimeZone') as tz`;
      expect(row?.tz).toBe('Asia/Damascus');
      const page = async (query: string) => {
        const res = await apart.inject({
          method: 'GET',
          url: `/v1/sales?${query}`,
          headers: bearer(store.accessToken),
        });
        expect(res.statusCode, res.body).toBe(200);
        return res.json<SaleListPage>();
      };
      const first = await page('limit=2');
      expect(first.nextCursor).not.toBeNull();
      const second = await page(`limit=2&cursor=${first.nextCursor}`);
      expect(second.items).toHaveLength(1);
      expect([...first.items, ...second.items].map((i) => i.id)).toEqual(
        (await list(store.accessToken)).items.map((i) => i.id),
      );
    } finally {
      await apart.close();
      await damascus.client.end();
    }
  });

  it('marks an invoice partly returned, then returned, and filters by status', async () => {
    const store = await openStore(app);
    const day = await aDay(store);
    const first = returnOf(store, day, 1000);
    await push(app, store.device, [first]);
    const partly = await list(store.accessToken, 'status=partly_returned');
    expect(partly.items.map((i) => i.number)).toEqual([day.card.number]);
    expect(partly.items[0]).toMatchObject({ status: 'partly_returned', returnedMinor: 200_000 });
    expect((await list(store.accessToken, 'status=paid')).items).toHaveLength(2);
    expect((await list(store.accessToken, 'status=returned')).items).toEqual([]);

    const back = (first.payload as unknown as ReturnType<typeof buildReturnPayload>).lines.map((l) => ({
      saleLineNo: l.saleLineNo,
      qty: l.qty,
      ...l.refund,
    }));
    await push(app, store.device, [returnOf(store, day, 1000, back)]);
    const done = await list(store.accessToken, 'status=returned');
    expect(done.items.map((i) => i.number)).toEqual([day.card.number]);
    expect(done.items[0]!.returnedMinor).toBe(400_000);
  });

  it('keeps one store’s invoices out of another’s list, and refuses its branch', async () => {
    const store = await openStore(app, '0911111111');
    const other = await openStore(app, '0922222222');
    await aDay(store);
    expect((await list(other.accessToken)).items).toEqual([]);
    const res = await get(other.accessToken, `/v1/sales?branchId=${store.device.branchId}`);
    expect(res.statusCode).toBe(404);
  });

  it('refuses a person without report.view (403) and limits a branch role to its branch', async () => {
    const store = await openStore(app);
    await aDay(store);
    const cashier = await staffUser(app, asTestStore(store), 'cashier', '0933333333');
    expect((await get(cashier.accessToken, '/v1/sales')).statusCode).toBe(403);

    const [second] = await ownerDb()<{ id: string }[]>`
      insert into branches (tenant_id, code, name) values (${store.tenantId}, '002', 'فرع ثان') returning id`;
    const local = await personWith(store, ['report.view'], '0944444444', second!.id);
    expect((await list(local.accessToken)).items).toEqual([]);
    expect((await get(local.accessToken, `/v1/sales?branchId=${store.device.branchId}`)).statusCode).toBe(
      403,
    );
    expect((await list(local.accessToken, `branchId=${second!.id}`)).items).toEqual([]);
    const first = (await list(store.accessToken)).items[0]!;
    expect((await get(local.accessToken, `/v1/sales/${first.id}`)).statusCode).toBe(404);

    // A role for the first branch sees its sales
    const here = await personWith(store, ['report.view'], '0955555555', store.device.branchId);
    expect((await list(here.accessToken)).items).toHaveLength(3);
    expect((await get(here.accessToken, `/v1/sales/${first.id}`)).statusCode).toBe(200);
  });

  it('answers 401 without a token', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/sales' })).statusCode).toBe(401);
  });
});

describe('GET /v1/sales/{id}', () => {
  it('returns the sale with its payload, payments, linked returns and what a reprint needs', async () => {
    const store = await openStore(app);
    const day = await aDay(store);
    await push(app, store.device, [returnOf(store, day, 1000)]);
    const res = await get(store.accessToken, `/v1/sales/${day.card.id}`);
    expect(res.statusCode, res.body).toBe(200);
    const detail = res.json<SaleDetail>();
    expect(detail).toMatchObject({
      id: day.card.id,
      number: day.card.number,
      status: 'partly_returned',
      customer: { id: day.customerId, name: 'ريم' },
      device: { id: store.device.deviceId, code: store.device.code },
      receipt: {
        branchName: expect.any(String),
        deviceName: expect.any(String),
        cashierName: 'أحمد الخطيب',
      },
    });
    expect(detail.payload.lines).toHaveLength(1);
    expect(detail.payload.payments[0]).toMatchObject({ method: 'card', reference: '731205' });
    expect(detail.payload.totals.totalMinor).toBe(400_000);
    expect(detail.returns).toEqual([
      expect.objectContaining({
        number: expect.stringMatching(/^SRT-/),
        totalMinor: 200_000,
        reason: 'مقاس خاطئ',
      }),
    ]);
  });

  it('answers 404 for an unknown id or a malformed one, and 403 without report.view', async () => {
    const store = await openStore(app);
    const day = await aDay(store);
    expect((await get(store.accessToken, '/v1/sales/0192a3b4-c5d6-7e8f-9a0b-000000000999')).statusCode).toBe(
      404,
    );
    expect((await get(store.accessToken, '/v1/sales/not-an-id')).statusCode).toBe(404);
    // Another store's owner cannot open it by its id
    const other = await openStore(app, '0922222222');
    const foreign = await get(other.accessToken, `/v1/sales/${day.card.id}`);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).not.toContain(day.card.number!);
    const cashier = await staffUser(app, asTestStore(store), 'cashier', '0933333333');
    expect((await get(cashier.accessToken, `/v1/sales/${day.card.id}`)).statusCode).toBe(403);
  });
});
