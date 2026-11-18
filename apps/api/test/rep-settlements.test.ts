import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  CommissionPlanRow,
  DistributionReport,
  DistributionSettings,
  ProductDetail,
  RepRow,
  RepSettlementDetail,
  RepSettlementRow,
  RepTargetRow,
  RouteDetail,
  SettlementPreview,
  SupplierRow,
  TodayBoard,
  VanRow,
} from '@serva/core';
import type { PullResponse } from '@serva/sync';
import { hashDeviceToken } from '../src/auth/device-guard';
import {
  createUuidV7,
  formatDocNumber,
  payloadHash,
  seriesOf,
  type DocType,
  type SyncDocument,
} from '@serva/sync';
import { cartLine, DATE, movement, push, sale, shiftClose, shiftOpen } from './accounting-fixtures';
import { createDevice, type TestDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase, settled } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

/**
 * «تسوية المندوب» and the supervisor's views of the reps (WP4): the evening settlement (a record that
 * posts nothing, then the van count and the unloading transfer on approval), the phone's van count,
 * the day board, the targets, the reports, the pending customer of a rep phone and the resync of a
 * phone whose route lost customers.
 */

let app: FastifyInstance;
let s: TestStore;

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await ownerDb()`update plans set limits = limits || '{"reps": 0}'::jsonb where is_free`;
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(async () => {
  await resetDatabase();
  await ownerDb()`update plans set limits = limits || '{"reps": null}'::jsonb`;
  s = await testStore(app);
});

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (token: string, method: Method, url: string, payload?: unknown) =>
  app.inject({ method, url, headers: bearer(token), ...(payload ? { payload: payload as object } : {}) });
const ok = async <T>(token: string, method: Method, url: string, payload?: unknown, status = 200) => {
  const res = await call(token, method, url, payload);
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(status);
  return res.json<T>();
};

async function repPhone(tenantId: string, branchId: string, code: string): Promise<TestDevice> {
  const token = `sdt_${randomBytes(32).toString('base64url')}`;
  const [row] = await ownerDb()<{ id: string }[]>`
    insert into devices (tenant_id, branch_id, code, name, kind, status, token_hash)
    values (${tenantId}, ${branchId}, ${code}, ${`هاتف ${code}`}, 'rep_phone', 'active', ${hashDeviceToken(token)})
    returning id`;
  return { deviceId: row!.id, tenantId, branchId, code, token, authorization: `Device ${token}` };
}

const deviceCall = (device: TestDevice, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: { authorization: device.authorization },
    ...(payload ? { payload: payload as object } : {}),
  });

let phoneSeq = 0;
const newId = createUuidV7();

/** Documents as a rep phone makes them: numbered in its van's branch (the number carries the branch code) */
function documents(device: TestDevice, branchCode: string, businessDate = DATE) {
  let seq = 0;
  const counters = new Map<string, number>();
  return (type: DocType, payload: unknown, id = newId()): SyncDocument => {
    seq += 1;
    const series = seriesOf(type);
    const n = series ? (counters.get(series) ?? 0) + 1 : 0;
    if (series) counters.set(series, n);
    const body = {
      id,
      seq,
      type,
      number: series ? formatDocNumber({ series, branchCode, deviceCode: device.code, sequence: n }) : null,
      deviceTime: `${businessDate}T08:59:00.000Z`,
      businessDate,
      deviceOffsetMs: 0,
      engineVersion: '1.0.0',
      contractVersion: 1,
      deps: [],
      payload: payload as Record<string, unknown>,
    };
    return { ...body, hash: payloadHash(body) };
  };
}

const branchCodeOf = async (branchId: string) =>
  (await ownerDb()<{ code: string }[]>`select code from branches where id = ${branchId}`)[0]!.code;

interface World {
  van: VanRow;
  rep: RepRow;
  repUserId: string;
  phone: TestDevice;
  route: RouteDetail;
  customerId: string;
  second: string;
  variantId: string;
  productId: string;
  shiftId: string;
  chequeId: string;
  mainBranch: string;
  doc: ReturnType<typeof documents>;
}

/**
 * A rep with a van holding 10 pieces. On the phone's day (DATE): a shift opened with 100,000, two pieces
 * sold for cash (200,000), 30,000 collected, a 40,000 cheque, 150,000 dropped into the safe and the
 * shift closed counting 180,000. So he should hand over 330,000, with 8 pieces left in the van.
 */
async function world(tag = '1', options: { sell?: boolean } = {}): Promise<World> {
  const owner = bearer(s.accessToken);
  const product = (
    await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: owner,
      payload: { nameAr: `قميص ${tag}`, variants: [{ price: { currency: 'SYP', priceMinor: 100_000 } }] },
    })
  ).json<ProductDetail>();
  const variantId = product.variants[0]!.id;
  const supplier = (
    await app.inject({
      method: 'POST',
      url: '/v1/suppliers',
      headers: owner,
      payload: { name: `معمل ${tag}` },
    })
  ).json<SupplierRow>();
  const bought = await app.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: owner,
    payload: {
      supplierId: supplier.id,
      branchId: s.branchId,
      date: '2026-10-29',
      payment: 'credit',
      lines: [{ variantId, qty: 10_000, costMinor: 400_000 }],
    },
  });
  expect(bought.statusCode, bought.body).toBe(201);
  const van = await ok<VanRow>(
    s.accessToken,
    'POST',
    '/v1/vans',
    { name: `سيارة ${tag}`, parentBranchId: s.branchId },
    201,
  );
  const load = await call(s.accessToken, 'POST', '/v1/transfers', {
    fromBranchId: s.branchId,
    toBranchId: van.id,
    date: '2026-10-29',
    lines: [{ variantId, qty: 10_000 }],
  });
  expect(load.statusCode, load.body).toBe(201);
  const staff = await staffUser(app, s, 'rep', `0955${String(++phoneSeq).padStart(6, '0')}`, {
    fullName: `مندوب ${tag}`,
  });
  const rep = await ok<RepRow>(
    s.accessToken,
    'POST',
    '/v1/reps',
    { userId: staff.userId, branchId: s.branchId, vanBranchId: van.id },
    201,
  );
  const phone = await repPhone(s.tenantId, van.id, '002');
  const customerId = (
    await ok<{ id: string }>(s.accessToken, 'POST', '/v1/customers', { name: `زبون ${tag}` }, 201)
  ).id;
  const second = (
    await ok<{ id: string }>(s.accessToken, 'POST', '/v1/customers', { name: `زبون ثان ${tag}` }, 201)
  ).id;
  const made = await ok<RouteDetail>(
    s.accessToken,
    'POST',
    '/v1/routes',
    { name: `خط ${tag}`, weekdays: [0, 1, 2, 3, 4, 5, 6], repId: rep.id },
    201,
  );
  const route = await ok<RouteDetail>(s.accessToken, 'PUT', `/v1/routes/${made.id}/customers`, {
    customerIds: [customerId, second],
    version: made.version,
  });

  const doc = documents(phone, await branchCodeOf(van.id));
  const open = doc('shift_open', shiftOpen(staff.userId));
  const cheque = doc('receipt', {
    customerId,
    customerName: 'زبون',
    shiftId: open.id,
    cashierId: staff.userId,
    currency: 'SYP',
    amountMinor: 40_000,
    method: 'cheque',
    reference: 'بنك · 777 · 2026-12-01',
    note: null,
    cheque: { bank: 'بنك', number: '777', dueDate: '2026-12-01', drawer: null },
  });
  const docs = [open, cheque];
  if (options.sell !== false) {
    docs.push(
      doc(
        'sale',
        sale({ userId: staff.userId }, open.id, {
          lines: [
            cartLine(1, 100_000, {
              productId: product.id,
              variantId,
              qty: 2000,
              name: product.nameAr,
            }),
          ],
          payments: [{ method: 'cash', currency: 'SYP', amountMinor: 200_000 }],
          customerId,
          customerName: 'زبون',
        }),
      ),
      doc('receipt', {
        customerId,
        customerName: 'زبون',
        shiftId: open.id,
        cashierId: staff.userId,
        currency: 'SYP',
        amountMinor: 30_000,
        method: 'cash',
        reference: null,
        note: null,
      }),
      doc('cash_movement', movement(staff.userId, open.id, 'safe_drop', 150_000)),
      doc(
        'shift_close',
        shiftClose(staff.userId, open.id, [
          { currency: 'SYP', opening: 100_000, cashIn: 200_000, drops: 150_000, counted: 180_000 },
        ]),
      ),
    );
  }
  const pushed = await push(app, phone, docs);
  expect(
    pushed.results.map((r) => r.status),
    JSON.stringify(pushed.results),
  ).toEqual(docs.map(() => 'accepted'));
  await settled();
  // The setup above told the phone to download again (it moved customers onto the route): start each test clean
  await ownerDb()`update devices set resync_sets = '{}' where id = ${phone.deviceId}`;
  return {
    van,
    rep,
    repUserId: staff.userId,
    phone,
    route,
    customerId,
    second,
    variantId,
    productId: product.id,
    shiftId: open.id,
    chequeId: cheque.id,
    mainBranch: s.branchId,
    doc,
  };
}

const sendCount = (w: World, counted: number, date = DATE) =>
  deviceCall(w.phone, 'POST', '/v1/device/rep/van-count', {
    businessDate: date,
    lines: [{ variantId: w.variantId, counted }],
  });

const previewOf = (w: World, date = DATE, token = s.accessToken) =>
  ok<SettlementPreview>(token, 'GET', `/v1/rep-settlements/preview?repId=${w.rep.id}&date=${date}`);

const stockOf = async (branchId: string, variantId: string) => {
  const [row] = await ownerDb()<{ qty: string }[]>`
    select qty::text from stock_levels where branch_id = ${branchId} and variant_id = ${variantId}`;
  return Number(row?.qty ?? 0);
};

const journalCount = async () =>
  Number(
    (
      await ownerDb()<{ n: string }[]>`
      select count(*)::text as n from journal_entries where tenant_id = ${s.tenantId}`
    )[0]!.n,
  );

describe('the phone’s van count', () => {
  it('is kept on the rep’s day, replaced when sent again, and refused from a till or for an unknown item', async () => {
    const w = await world();
    const first = await sendCount(w, 7000);
    expect(first.statusCode, first.body).toBe(200);
    expect((await sendCount(w, 6000)).statusCode).toBe(200);
    const [day] = await ownerDb()<
      { van_count: { at: string; lines: { variantId: string; counted: number }[] } }[]
    >`
      select van_count from rep_days where rep_id = ${w.rep.id} and business_date = ${DATE}::date`;
    expect(day!.van_count.lines).toEqual([{ variantId: w.variantId, counted: 6000 }]);
    expect(Number.isNaN(Date.parse(day!.van_count.at))).toBe(false);

    const till = await createDevice(s.tenantId);
    expect(
      (await deviceCall(till, 'POST', '/v1/device/rep/van-count', { businessDate: DATE, lines: [] }))
        .statusCode,
    ).toBe(403);
    const ghost = await deviceCall(w.phone, 'POST', '/v1/device/rep/van-count', {
      businessDate: DATE,
      lines: [{ variantId: randomUUID(), counted: 1000 }],
    });
    expect(ghost.statusCode).toBe(400);
    const negative = await deviceCall(w.phone, 'POST', '/v1/device/rep/van-count', {
      businessDate: DATE,
      lines: [{ variantId: w.variantId, counted: -1 }],
    });
    expect(negative.statusCode).toBe(400);
  });

  it('is refused while the plan has no reps, and for a phone without a rep on its van', async () => {
    const w = await world();
    const other = await ok<VanRow>(
      s.accessToken,
      'POST',
      '/v1/vans',
      { name: 'سيارة بلا مندوب', parentBranchId: s.branchId },
      201,
    );
    const lonely = await repPhone(s.tenantId, other.id, '003');
    expect(
      (await deviceCall(lonely, 'POST', '/v1/device/rep/van-count', { businessDate: DATE, lines: [] }))
        .statusCode,
    ).toBe(403);
    await ownerDb()`update plans set limits = limits || '{"reps": 0}'::jsonb`;
    const res = await sendCount(w, 7000);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('plan_limit_reached');
  });
});

describe('the settlement', () => {
  it('reads the drawer, cheques, sales, receipts and the van count into one preview', async () => {
    const w = await world();
    await sendCount(w, 7000);
    const p = await previewOf(w);
    expect(p).toMatchObject({
      repId: w.rep.id,
      businessDate: DATE,
      vanBranchId: w.van.id,
      unloadBranchId: s.branchId,
      keepStockInVan: false,
      existing: null,
      pendingDocs: 0,
    });
    expect(p.cash).toEqual([
      {
        currency: 'SYP',
        openingMinor: 100_000,
        cashSalesMinor: 200_000,
        changeGivenMinor: 0,
        refundsMinor: 0,
        receiptsMinor: 30_000,
        payInMinor: 0,
        payOutMinor: 0,
        dropsMinor: 150_000,
        closingCountedMinor: 180_000,
        expectedMinor: 330_000,
      },
    ]);
    expect(p.sales).toMatchObject({ count: 1, totalMinor: 200_000, receiptsCount: 2, returnsCount: 0 });
    expect(p.shifts).toHaveLength(1);
    expect(p.shifts[0]).toMatchObject({ id: w.shiftId, status: 'closed' });
    expect(p.cheques).toEqual([
      expect.objectContaining({
        sourceType: 'receipt',
        sourceId: w.chequeId,
        amountMinor: 40_000,
        currency: 'SYP',
      }),
    ]);
    expect(p.items).toEqual([
      {
        variantId: w.variantId,
        name: expect.any(String),
        expectedQty: 8000,
        countedQty: 7000,
        diffQty: -1000,
      },
    ]);
    expect(p.vanCountAt).not.toBeNull();
  });

  it('has no count until the phone sends one, and a day without shifts shows an empty drawer', async () => {
    const w = await world();
    const p = await previewOf(w);
    expect(p.vanCountAt).toBeNull();
    expect(p.items[0]).toMatchObject({ expectedQty: 8000, countedQty: null, diffQty: null });
    const empty = await previewOf(w, '2026-10-01');
    expect(empty.cash).toEqual([]);
    expect(empty.sales.count).toBe(0);
  });

  it('records a draft that posts nothing, once a day, then settles the van on approval', async () => {
    const w = await world();
    await sendCount(w, 7000);
    const before = await journalCount();
    const made = await ok<RepSettlementDetail>(
      s.accessToken,
      'POST',
      '/v1/rep-settlements',
      {
        repId: w.rep.id,
        businessDate: DATE,
        countedCash: { SYP: 320_000 },
        treatment: 'rep_debt',
        note: 'نقص عشرة آلاف',
        receivedCheques: [w.chequeId],
      },
      201,
    );
    expect(made).toMatchObject({
      status: 'draft',
      repName: 'مندوب 1',
      expectedCash: { SYP: 330_000 },
      countedCash: { SYP: 320_000 },
      cashDifference: { SYP: -10_000 },
      treatment: 'rep_debt',
      version: 1,
    });
    expect(made.number).toMatch(/^RST-2026-\d{6}$/);
    expect(made.cheques.received).toEqual([w.chequeId]);
    expect(made.cheques.unmatched).toEqual([]);
    expect(made.goods).toMatchObject({ counted: true, stocktakeId: null, transferId: null });
    // A record only: no entry, no stock moved
    expect(await journalCount()).toBe(before);
    expect(await stockOf(w.van.id, w.variantId)).toBe(8000);

    const again = await call(s.accessToken, 'POST', '/v1/rep-settlements', {
      repId: w.rep.id,
      businessDate: DATE,
      countedCash: { SYP: 330_000 },
    });
    expect(again.statusCode).toBe(409);
    expect((await previewOf(w)).existing).toMatchObject({ id: made.id, status: 'draft' });

    const done = await ok<RepSettlementDetail>(
      s.accessToken,
      'POST',
      `/v1/rep-settlements/${made.id}/approve`,
      {
        version: made.version,
      },
    );
    expect(done.status).toBe('approved');
    expect(done.approvedAt).not.toBeNull();
    expect(done.goods.stocktakeNumber).toMatch(/^STK-/);
    expect(done.goods.transferNumber).toMatch(/^TRF-/);
    // The van is counted to 7 (a loss of one) and the 7 go home; the van is empty
    expect(await stockOf(w.van.id, w.variantId)).toBe(0);
    expect(await stockOf(s.branchId, w.variantId)).toBe(7000);
    const [loss] = await ownerDb()<{ n: string }[]>`
      select count(*)::text as n from journal_entries where tenant_id = ${s.tenantId} and source_type = 'stocktake'`;
    expect(Number(loss!.n)).toBe(1);
    const [day] = await ownerDb()<{ stocktake_id: string | null; unload_transfer_id: string | null }[]>`
      select stocktake_id, unload_transfer_id from rep_days where rep_id = ${w.rep.id}`;
    expect(day).toEqual({ stocktake_id: done.goods.stocktakeId, unload_transfer_id: done.goods.transferId });

    // Approved twice, or cancelled after: refused, and nothing is made twice
    expect(
      (await call(s.accessToken, 'POST', `/v1/rep-settlements/${made.id}/approve`, { version: done.version }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await call(s.accessToken, 'POST', `/v1/rep-settlements/${made.id}/cancel`, {
          version: done.version,
          reason: 'خطأ',
        })
      ).statusCode,
    ).toBe(409);
    const [counts] = await ownerDb()<{ stk: string; trf: string }[]>`
      select (select count(*) from stocktakes where tenant_id = ${s.tenantId})::text as stk,
             (select count(*) from transfers where tenant_id = ${s.tenantId})::text as trf`;
    expect(counts).toEqual({ stk: '1', trf: '2' });
    const list = await ok<RepSettlementRow[]>(s.accessToken, 'GET', `/v1/rep-settlements?repId=${w.rep.id}`);
    expect(list).toEqual([expect.objectContaining({ id: made.id, status: 'approved' })]);
  });

  it('uses the supervisor’s own count over the phone’s, and keeps the goods in the van when the store says so', async () => {
    const w = await world();
    await sendCount(w, 5000);
    const settings = await ok<DistributionSettings>(s.accessToken, 'GET', '/v1/distribution/settings');
    await ok(s.accessToken, 'PUT', '/v1/distribution/settings', {
      ...settings,
      keepStockInVanOvernight: true,
    });
    const made = await ok<RepSettlementDetail>(
      s.accessToken,
      'POST',
      '/v1/rep-settlements',
      {
        repId: w.rep.id,
        businessDate: DATE,
        countedCash: { SYP: 330_000 },
        vanCount: [{ variantId: w.variantId, countedQty: 8000 }],
      },
      201,
    );
    expect(made.goods.lines).toEqual([expect.objectContaining({ countedQty: 8000, diffQty: 0 })]);
    expect(made.cashDifference).toEqual({ SYP: 0 });
    const done = await ok<RepSettlementDetail>(
      s.accessToken,
      'POST',
      `/v1/rep-settlements/${made.id}/approve`,
      {
        version: made.version,
      },
    );
    expect(done.goods.transferId).toBeNull();
    expect(await stockOf(w.van.id, w.variantId)).toBe(8000);
  });

  it('settles with no count at all: only the cash is recorded, the van is left as it is', async () => {
    const w = await world();
    const made = await ok<RepSettlementDetail>(
      s.accessToken,
      'POST',
      '/v1/rep-settlements',
      { repId: w.rep.id, businessDate: DATE, countedCash: { SYP: 330_000 } },
      201,
    );
    expect(made.goods.counted).toBe(false);
    const done = await ok<RepSettlementDetail>(
      s.accessToken,
      'POST',
      `/v1/rep-settlements/${made.id}/approve`,
      {
        version: made.version,
      },
    );
    expect(done).toMatchObject({ status: 'approved', goods: { stocktakeId: null, transferId: null } });
    expect(await stockOf(w.van.id, w.variantId)).toBe(8000);
  });

  it('cancels a draft with a reason, then a new one for the day can be made; a stale version is refused', async () => {
    const w = await world();
    const made = await ok<RepSettlementDetail>(
      s.accessToken,
      'POST',
      '/v1/rep-settlements',
      { repId: w.rep.id, businessDate: DATE, countedCash: { SYP: 1 } },
      201,
    );
    expect(
      (
        await call(s.accessToken, 'POST', `/v1/rep-settlements/${made.id}/cancel`, {
          version: 9,
          reason: 'خطأ في العد',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call(s.accessToken, 'POST', `/v1/rep-settlements/${made.id}/cancel`, {
          version: 1,
          reason: 'x',
        })
      ).statusCode,
    ).toBe(400);
    const cancelled = await ok<RepSettlementDetail>(
      s.accessToken,
      'POST',
      `/v1/rep-settlements/${made.id}/cancel`,
      {
        version: 1,
        reason: 'خطأ في العد',
      },
    );
    expect(cancelled.status).toBe('cancelled');
    const next = await ok<RepSettlementDetail>(
      s.accessToken,
      'POST',
      '/v1/rep-settlements',
      { repId: w.rep.id, businessDate: DATE, countedCash: { SYP: 330_000 } },
      201,
    );
    expect(next.number).not.toBe(made.number);
    // A cheque that is not of this day, and a rep that is not the store’s
    expect(
      (
        await call(s.accessToken, 'POST', '/v1/rep-settlements', {
          repId: w.rep.id,
          businessDate: '2026-10-01',
          countedCash: {},
          receivedCheques: [randomUUID()],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(s.accessToken, 'POST', '/v1/rep-settlements', {
          repId: randomUUID(),
          businessDate: DATE,
          countedCash: {},
        })
      ).statusCode,
    ).toBe(404);
  });

  it('lets a sales supervisor record it but not unload the van, and says who may; others see nothing', async () => {
    const w = await world();
    await sendCount(w, 7000);
    const supervisor = await staffUser(app, s, 'sales_supervisor', '0955900001');
    const cashier = await staffUser(app, s, 'cashier', '0955900002');
    const made = await ok<RepSettlementDetail>(
      supervisor.accessToken,
      'POST',
      '/v1/rep-settlements',
      { repId: w.rep.id, businessDate: DATE, countedCash: { SYP: 330_000 } },
      201,
    );
    // The van count and the transfer need the stock permission, which the supervisor role does not hold
    const refused = await call(supervisor.accessToken, 'POST', `/v1/rep-settlements/${made.id}/approve`, {
      version: made.version,
    });
    expect(refused.statusCode).toBe(403);
    const again = await ok<RepSettlementDetail>(
      supervisor.accessToken,
      'GET',
      `/v1/rep-settlements/${made.id}`,
    );
    expect(again.status).toBe('draft');
    const [claim] = await ownerDb()<{ claimed: string | null }[]>`
      select goods_difference ->> 'claimedAt' as claimed from rep_settlements where id = ${made.id}`;
    expect(claim!.claimed).toBeNull();
    // The owner finishes it
    expect(
      (
        await ok<RepSettlementDetail>(s.accessToken, 'POST', `/v1/rep-settlements/${made.id}/approve`, {
          version: again.version,
        })
      ).status,
    ).toBe('approved');

    for (const [method, url] of [
      ['GET', `/v1/rep-settlements/preview?repId=${w.rep.id}&date=${DATE}`],
      ['GET', '/v1/rep-settlements'],
      ['GET', `/v1/rep-settlements/${made.id}`],
    ] as const) {
      expect((await call(cashier.accessToken, method, url)).statusCode, url).toBe(403);
    }
    expect(
      (
        await call(cashier.accessToken, 'POST', '/v1/rep-settlements', {
          repId: w.rep.id,
          businessDate: DATE,
          countedCash: {},
        })
      ).statusCode,
    ).toBe(403);
  });

  it('never shows or touches another store’s settlement or rep, and is hidden while the plan has no reps', async () => {
    const w = await world();
    const made = await ok<RepSettlementDetail>(
      s.accessToken,
      'POST',
      '/v1/rep-settlements',
      { repId: w.rep.id, businessDate: DATE, countedCash: { SYP: 1 } },
      201,
    );
    const other = await testStore(app, '0922222222');
    expect((await call(other.accessToken, 'GET', `/v1/rep-settlements/${made.id}`)).statusCode).toBe(404);
    expect(
      (await call(other.accessToken, 'POST', `/v1/rep-settlements/${made.id}/approve`, { version: 1 }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await call(other.accessToken, 'POST', `/v1/rep-settlements/${made.id}/cancel`, {
          version: 1,
          reason: 'سبب',
        })
      ).statusCode,
    ).toBe(404);
    expect(await ok<RepSettlementRow[]>(other.accessToken, 'GET', '/v1/rep-settlements')).toEqual([]);
    expect(
      (await call(other.accessToken, 'GET', `/v1/rep-settlements/preview?repId=${w.rep.id}&date=${DATE}`))
        .statusCode,
    ).toBe(404);
    expect((await call(s.accessToken, 'GET', '/v1/rep-settlements/not-an-id')).statusCode).toBe(404);

    await ownerDb()`update plans set limits = limits || '{"reps": 0}'::jsonb`;
    const gated = await call(s.accessToken, 'GET', '/v1/rep-settlements');
    expect(gated.statusCode).toBe(403);
    expect(gated.json().error.code).toBe('plan_limit_reached');
  });
});

describe('a customer a rep’s phone adds', () => {
  const customerPayload = (name: string, createdBy: string) => ({ name, phone: null, createdBy });
  const statusOf = async (id: string) =>
    (
      await ownerDb()<{ approval_status: string }[]>`select approval_status from customers where id = ${id}`
    )[0]!.approval_status;

  it('waits for the supervisor when the store asks for it, and is approved at once when it does not', async () => {
    const w = await world('c', { sell: false });
    const one = w.doc('customer', customerPayload('زبون المندوب', w.repUserId));
    expect((await push(app, w.phone, [one])).results[0]!.status).toBe('accepted');
    expect(await statusOf(one.id)).toBe('pending');

    const settings = await ok<DistributionSettings>(s.accessToken, 'GET', '/v1/distribution/settings');
    await ok(s.accessToken, 'PUT', '/v1/distribution/settings', {
      ...settings,
      requireCustomerApproval: false,
    });
    const two = w.doc('customer', customerPayload('زبون ثان للمندوب', w.repUserId));
    await push(app, w.phone, [two]);
    expect(await statusOf(two.id)).toBe('approved');
  });

  it('is approved when a till adds it, whatever the store’s rule', async () => {
    const till = await createDevice(s.tenantId);
    const one = documents(till, '001')('customer', customerPayload('زبون الكاشير', s.userId));
    await push(app, till, [one]);
    expect(await statusOf(one.id)).toBe('approved');
  });
});

describe('a phone whose route lost customers', () => {
  const pull = (device: TestDevice) => deviceCall(device, 'GET', '/v1/sync/pull');
  const flags = async (device: TestDevice) =>
    (
      await ownerDb()<
        { resync_sets: string[] }[]
      >`select resync_sets from devices where id = ${device.deviceId}`
    )[0]!.resync_sets.toSorted();

  it('is told to download its customers, routes and route customers again, once', async () => {
    const w = await world('r', { sell: false });
    expect(await flags(w.phone)).toEqual([]);
    // The phone has pulled its sets once: it holds the customers of the route
    const held = (await pull(w.phone)).json<PullResponse>();
    const cursors = encodeURIComponent(
      JSON.stringify(
        Object.fromEntries(
          ['customers', 'route_customers', 'routes'].map((name) => [name, held.sets[name]!.cursor]),
        ),
      ),
    );
    const route = await ok<RouteDetail>(s.accessToken, 'GET', `/v1/routes/${w.route.id}`);
    await ok(s.accessToken, 'PUT', `/v1/routes/${w.route.id}/customers`, {
      customerIds: [w.customerId],
      version: route.version,
    });
    expect(await flags(w.phone)).toEqual(['customers', 'route_customers', 'routes']);
    const first = await deviceCall(w.phone, 'GET', `/v1/sync/pull?cursors=${cursors}`);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<PullResponse>().commands.resync?.toSorted()).toEqual([
      'customers',
      'route_customers',
      'routes',
    ]);
    expect(await flags(w.phone)).toEqual([]);
    const next = await deviceCall(w.phone, 'GET', `/v1/sync/pull?cursors=${cursors}`);
    expect(next.json<PullResponse>().commands.resync ?? []).toEqual([]);
  });

  it('is told too when a customer joins the route, or the route goes to another rep, and not for a rename', async () => {
    const w = await world('s', { sell: false });
    const third = (await ok<{ id: string }>(s.accessToken, 'POST', '/v1/customers', { name: 'ثالث' }, 201))
      .id;
    let route = await ok<RouteDetail>(s.accessToken, 'GET', `/v1/routes/${w.route.id}`);
    route = await ok<RouteDetail>(s.accessToken, 'PATCH', `/v1/routes/${w.route.id}`, {
      name: 'خط جديد الاسم',
      weekdays: route.weekdays,
      repId: w.rep.id,
      version: route.version,
    });
    expect(await flags(w.phone)).toEqual([]);
    route = await ok<RouteDetail>(s.accessToken, 'PUT', `/v1/routes/${w.route.id}/customers`, {
      customerIds: [w.customerId, w.second, third],
      version: route.version,
    });
    expect(await flags(w.phone)).toHaveLength(3);
    await pull(w.phone);
    expect(await flags(w.phone)).toEqual([]);
    // The route goes unassigned: the rep’s phone forgets it
    await ok(s.accessToken, 'PATCH', `/v1/routes/${w.route.id}`, {
      name: 'خط جديد الاسم',
      weekdays: route.weekdays,
      repId: null,
      version: route.version,
    });
    expect(await flags(w.phone)).toHaveLength(3);
  });

  it('does not touch a till or another rep’s phone', async () => {
    const w = await world('t', { sell: false });
    const till = await createDevice(s.tenantId);
    const route = await ok<RouteDetail>(s.accessToken, 'GET', `/v1/routes/${w.route.id}`);
    await ok(s.accessToken, 'PUT', `/v1/routes/${w.route.id}/customers`, {
      customerIds: [],
      version: route.version,
    });
    expect(await flags(till)).toEqual([]);
    expect(await flags(w.phone)).toHaveLength(3);
  });
});

describe('the targets', () => {
  it('keeps a monthly target per rep, counts what he really did, and edits, refuses stale ones and deletes', async () => {
    const w = await world();
    const made = await ok<RepTargetRow>(
      s.accessToken,
      'POST',
      '/v1/rep-targets',
      {
        repId: w.rep.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        metric: 'net_sales',
        targetValue: 400_000,
      },
      201,
    );
    expect(made).toMatchObject({
      repName: 'مندوب 1',
      actualValue: 200_000,
      percent: 50,
      scope: 'all',
      version: 1,
    });
    const qty = await ok<RepTargetRow>(
      s.accessToken,
      'POST',
      '/v1/rep-targets',
      {
        repId: w.rep.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        metric: 'qty',
        scope: 'product',
        productId: w.productId,
        targetValue: 4000,
      },
      201,
    );
    expect(qty).toMatchObject({ actualValue: 2000, percent: 50 });
    const collections = await ok<RepTargetRow>(
      s.accessToken,
      'POST',
      '/v1/rep-targets',
      {
        repId: w.rep.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        metric: 'collections',
        targetValue: 100_000,
      },
      201,
    );
    expect(collections.actualValue).toBe(70_000);

    const month = await ok<RepTargetRow[]>(
      s.accessToken,
      'GET',
      `/v1/rep-targets?month=2026-10&repId=${w.rep.id}`,
    );
    expect(month).toHaveLength(3);
    expect(await ok<RepTargetRow[]>(s.accessToken, 'GET', '/v1/rep-targets?month=2026-09')).toEqual([]);

    const edited = await ok<RepTargetRow>(s.accessToken, 'PUT', `/v1/rep-targets/${made.id}`, {
      targetValue: 200_000,
      version: 1,
    });
    expect(edited).toMatchObject({ targetValue: 200_000, percent: 100, version: 2 });
    expect(
      (await call(s.accessToken, 'PUT', `/v1/rep-targets/${made.id}`, { targetValue: 5, version: 1 }))
        .statusCode,
    ).toBe(409);
    expect((await call(s.accessToken, 'DELETE', `/v1/rep-targets/${made.id}`)).statusCode).toBe(204);
    expect((await call(s.accessToken, 'DELETE', `/v1/rep-targets/${made.id}`)).statusCode).toBe(404);
  });

  it('refuses a product or category that is not there, a period backwards, and a collection for one product', async () => {
    const w = await world();
    const bad = (extra: Record<string, unknown>) =>
      call(s.accessToken, 'POST', '/v1/rep-targets', {
        repId: w.rep.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        metric: 'net_sales',
        targetValue: 1,
        ...extra,
      });
    expect((await bad({ scope: 'product', productId: randomUUID() })).statusCode).toBe(400);
    expect((await bad({ scope: 'category', categoryId: randomUUID() })).statusCode).toBe(400);
    expect((await bad({ periodEnd: '2026-09-30' })).statusCode).toBe(400);
    expect((await bad({ metric: 'collections', scope: 'product', productId: w.productId })).statusCode).toBe(
      400,
    );
    expect((await bad({ repId: randomUUID() })).statusCode).toBe(404);
  });

  it('is the supervisor’s, and no other store reads or edits it', async () => {
    const w = await world();
    const made = await ok<RepTargetRow>(
      s.accessToken,
      'POST',
      '/v1/rep-targets',
      {
        repId: w.rep.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        metric: 'net_sales',
        targetValue: 1,
      },
      201,
    );
    const cashier = await staffUser(app, s, 'cashier', '0955900003');
    expect((await call(cashier.accessToken, 'GET', '/v1/rep-targets')).statusCode).toBe(403);
    expect(
      (
        await call(cashier.accessToken, 'POST', '/v1/rep-targets', {
          repId: w.rep.id,
          periodStart: '2026-10-01',
          periodEnd: '2026-10-31',
          metric: 'net_sales',
          targetValue: 1,
        })
      ).statusCode,
    ).toBe(403);
    const supervisor = await staffUser(app, s, 'sales_supervisor', '0955900004');
    expect((await ok<RepTargetRow[]>(supervisor.accessToken, 'GET', '/v1/rep-targets')).length).toBe(1);
    const other = await testStore(app, '0922222223');
    expect(await ok<RepTargetRow[]>(other.accessToken, 'GET', '/v1/rep-targets')).toEqual([]);
    expect(
      (await call(other.accessToken, 'PUT', `/v1/rep-targets/${made.id}`, { targetValue: 2, version: 1 }))
        .statusCode,
    ).toBe(404);
    expect((await call(other.accessToken, 'DELETE', `/v1/rep-targets/${made.id}`)).statusCode).toBe(404);
  });
});

describe('the day board', () => {
  it('shows each rep’s route, who is where, the visits and what he sold and collected', async () => {
    const w = await world();
    const visit = (customerId: string, extra: Record<string, unknown>) =>
      deviceCall(w.phone, 'POST', '/v1/device/rep/visits', {
        id: randomUUID(),
        businessDate: DATE,
        customerId,
        routeId: w.route.id,
        offRoute: false,
        arrivedAt: `${DATE}T09:00:00.000Z`,
        ...extra,
      });
    expect((await visit(w.customerId, { leftAt: `${DATE}T09:20:00.000Z`, outcome: 'sale' })).statusCode).toBe(
      201,
    );
    expect((await visit(w.second, { leftAt: null, outcome: 'none' })).statusCode).toBe(201);
    const board = await ok<TodayBoard>(s.accessToken, 'GET', `/v1/distribution/today?date=${DATE}`);
    expect(board.date).toBe(DATE);
    const mine = board.reps.find((r) => r.repId === w.rep.id)!;
    expect(mine).toMatchObject({
      name: 'مندوب 1',
      // His van shift is closed, so the board says he ended his day
      day: 'closed',
      planned: 2,
      visited: 2,
      extraVisited: 0,
      currentCustomer: 'زبون ثان 1',
      sales: 1,
      orders: 0,
      returns: 0,
      salesTotalMinor: 200_000,
      collectedMinor: 70_000,
    });
    expect(mine.routeNames).toEqual(['خط 1']);
    expect(mine.stops.map((x) => x.status)).toEqual(['sale', 'here']);
    // A day nobody worked shows the plan and nothing done
    const quiet = await ok<TodayBoard>(s.accessToken, 'GET', '/v1/distribution/today?date=2026-01-04');
    expect(quiet.reps.find((r) => r.repId === w.rep.id)).toMatchObject({ day: 'none', visited: 0 });
  });

  it('is for report.view, hidden from another store, and gated by the plan', async () => {
    await world();
    const cashier = await staffUser(app, s, 'cashier', '0955900005');
    expect((await call(cashier.accessToken, 'GET', '/v1/distribution/today')).statusCode).toBe(403);
    const other = await testStore(app, '0922222224');
    expect((await ok<TodayBoard>(other.accessToken, 'GET', '/v1/distribution/today')).reps).toEqual([]);
    expect((await call(s.accessToken, 'GET', '/v1/distribution/today?date=oops')).statusCode).toBe(400);
    await ownerDb()`update plans set limits = limits || '{"reps": 0}'::jsonb`;
    expect((await call(s.accessToken, 'GET', '/v1/distribution/today')).json().error.code).toBe(
      'plan_limit_reached',
    );
  });
});

describe('the distribution reports', () => {
  const report = (kind: string, query = `from=2026-10-01&to=2026-10-31`) =>
    ok<DistributionReport>(s.accessToken, 'GET', `/v1/distribution/reports/${kind}?${query}`);

  it('adds up sales, returns, collections, products, customers and routes by rep', async () => {
    const w = await world();
    const byRep = await report('sales_by_rep');
    expect(byRep.rows).toEqual([{ rep: 'مندوب 1', invoices: 1, sales: 200_000, returns: 0, net: 200_000 }]);
    expect(byRep.totals).toMatchObject({ rep: 'المجموع', sales: 200_000, net: 200_000 });
    expect(byRep.columns.map((c) => c.key)).toEqual(['rep', 'invoices', 'sales', 'returns', 'net']);

    const byRoute = await report('sales_by_route');
    expect(byRoute.rows).toEqual([
      { route: 'خط 1', rep: 'مندوب 1', customers: 2, buyers: 1, invoices: 1, sales: 200_000 },
    ]);
    const byCustomer = await report('sales_by_customer');
    expect(byCustomer.rows[0]).toMatchObject({
      customer: 'زبون 1',
      invoices: 1,
      sales: 200_000,
      lastSale: DATE,
    });
    const byProduct = await report('sales_by_product');
    expect(byProduct.rows).toEqual([{ product: 'قميص 1', qty: 2000, sales: 200_000 }]);
    const collections = await report('collections');
    expect(collections.rows).toEqual([
      { rep: 'مندوب 1', currency: 'SYP', receipts: 2, cash: 30_000, cheque: 40_000, other: 0, total: 70_000 },
    ]);
    // A different period is empty
    expect((await report('sales_by_rep', 'from=2026-09-01&to=2026-09-30')).rows[0]).toMatchObject({
      sales: 0,
    });
    expect((await report('sales_by_product', 'from=2026-09-01&to=2026-09-30')).rows).toEqual([]);
    // One rep only
    expect(
      (await report('sales_by_rep', `from=2026-10-01&to=2026-10-31&repId=${w.rep.id}`)).rows,
    ).toHaveLength(1);
    expect(
      (
        await call(
          s.accessToken,
          'GET',
          `/v1/distribution/reports/sales_by_rep?from=2026-10-01&to=2026-10-31&repId=${randomUUID()}`,
        )
      ).statusCode,
    ).toBe(404);
  });

  it('shows the van’s stock, the returns rate, the visits and why nothing was sold', async () => {
    const w = await world();
    const reason = (
      await ok<{ id: string; name: string }[]>(s.accessToken, 'GET', '/v1/no-sale-reasons')
    )[0]!;
    const visit = (customerId: string, extra: Record<string, unknown>) =>
      deviceCall(w.phone, 'POST', '/v1/device/rep/visits', {
        id: randomUUID(),
        businessDate: DATE,
        customerId,
        routeId: w.route.id,
        arrivedAt: `${DATE}T09:00:00.000Z`,
        leftAt: `${DATE}T09:10:00.000Z`,
        ...extra,
      });
    await visit(w.customerId, { outcome: 'sale' });
    await visit(w.second, { outcome: 'no_sale', noSaleReasonId: reason.id });
    await visit(w.second, { outcome: 'no_sale', noSaleReasonId: reason.id, offRoute: true });

    const stock = await report('van_stock');
    expect(stock.rows).toEqual([{ rep: 'مندوب 1', van: 'سيارة 1', items: 1, qty: 8000, orders: 0 }]);
    const rate = await report('returns_rate');
    expect(rate.rows).toEqual([{ rep: 'مندوب 1', sales: 200_000, returns: 0, rate: 0 }]);
    const visits = await report('visits');
    expect(visits.rows[0]).toMatchObject({ rep: 'مندوب 1', visits: 3, sale: 1, noSale: 2, offRoute: 1 });
    const reasons = await report('no_sale_reasons');
    expect(reasons.rows).toEqual([{ reason: reason.name, visits: 2, share: 100 }]);
  });

  it('ages the debt of the rep’s customers, and shows targets and commissions without posting anything', async () => {
    const w = await world();
    await ok(
      s.accessToken,
      'POST',
      `/v1/customers/${w.second}/opening-debt`,
      { amountMinor: 500_000, date: '2026-08-01' },
      201,
    );
    const overdue = await report('overdue_by_rep', 'from=2026-10-01&to=2026-10-31');
    expect(overdue.rows).toEqual([
      { rep: 'مندوب 1', debtors: 1, debt: 500_000, overdue: 500_000, old: 500_000 },
    ]);

    await ok(
      s.accessToken,
      'POST',
      '/v1/rep-targets',
      {
        repId: w.rep.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        metric: 'net_sales',
        targetValue: 400_000,
      },
      201,
    );
    const targets = await report('targets');
    expect(targets.rows).toEqual([
      expect.objectContaining({
        rep: 'مندوب 1',
        metric: 'net_sales',
        target: 400_000,
        actual: 200_000,
        percent: 50,
      }),
    ]);

    const plan = await ok<CommissionPlanRow>(
      s.accessToken,
      'POST',
      '/v1/commission-plans',
      { name: 'خمسة بالمئة', basis: 'sales', mode: 'flat', rateBp: 500 },
      201,
    );
    await ok(s.accessToken, 'PATCH', `/v1/reps/${w.rep.id}`, {
      branchId: s.branchId,
      vanBranchId: w.van.id,
      commissionPlanId: plan.id,
      version: w.rep.version,
    });
    const before = await journalCount();
    const commissions = await report('commissions');
    expect(commissions.rows).toEqual([
      {
        rep: 'مندوب 1',
        plan: 'خمسة بالمئة',
        basis: 'المبيعات',
        base: 200_000,
        returns: 0,
        net: 200_000,
        rate: 5,
        commission: 10_000,
      },
    ]);
    expect(await journalCount()).toBe(before);
  });

  it('refuses a missing kind or period, a cashier, another store’s rep, and a plan without reps', async () => {
    const w = await world();
    expect(
      (await call(s.accessToken, 'GET', '/v1/distribution/reports/nothing?from=2026-10-01&to=2026-10-31'))
        .statusCode,
    ).toBe(404);
    expect((await call(s.accessToken, 'GET', '/v1/distribution/reports/visits')).statusCode).toBe(400);
    const cashier = await staffUser(app, s, 'cashier', '0955900006');
    expect(
      (
        await call(
          cashier.accessToken,
          'GET',
          '/v1/distribution/reports/visits?from=2026-10-01&to=2026-10-31',
        )
      ).statusCode,
    ).toBe(403);
    const other = await testStore(app, '0922222225');
    expect(
      (
        await call(
          other.accessToken,
          'GET',
          `/v1/distribution/reports/sales_by_rep?from=2026-10-01&to=2026-10-31&repId=${w.rep.id}`,
        )
      ).statusCode,
    ).toBe(404);
    await ownerDb()`update plans set limits = limits || '{"reps": 0}'::jsonb`;
    expect(
      (
        await call(s.accessToken, 'GET', '/v1/distribution/reports/visits?from=2026-10-01&to=2026-10-31')
      ).json().error.code,
    ).toBe('plan_limit_reached');
  });

  it('shows a supervisor tied to one branch only the reps of that branch', async () => {
    const w = await world();
    const mall = (await ok<{ id: string }>(s.accessToken, 'POST', '/v1/branches', { name: 'فرع المول' }, 201))
      .id;
    const mine = await staffUser(app, s, 'sales_supervisor', '0955900007', { branchId: mall });
    expect(
      (
        await ok<DistributionReport>(
          mine.accessToken,
          'GET',
          '/v1/distribution/reports/sales_by_rep?from=2026-10-01&to=2026-10-31',
        )
      ).rows,
    ).toEqual([]);
    const here = await staffUser(app, s, 'sales_supervisor', '0955900008', { branchId: w.mainBranch });
    expect(
      (
        await ok<DistributionReport>(
          here.accessToken,
          'GET',
          '/v1/distribution/reports/sales_by_rep?from=2026-10-01&to=2026-10-31',
        )
      ).rows,
    ).toHaveLength(1);
    // Nor may he settle a rep of a branch that is not his
    expect(
      (
        await call(mine.accessToken, 'POST', '/v1/rep-settlements', {
          repId: w.rep.id,
          businessDate: DATE,
          countedCash: {},
        })
      ).statusCode,
    ).toBe(403);
  });
});
