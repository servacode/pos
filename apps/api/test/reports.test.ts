import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  AccountListResponse,
  DayReport,
  JournalPage,
  ShiftListResponse,
  ShiftReport,
  SyncEvidence,
  TrialBalance,
} from '@serva/core';
import {
  cartLine,
  documents,
  goldenFirstSale,
  movement,
  newId,
  openStore,
  push,
  sale,
  shiftClose,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { createDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser } from './staff';

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

const asTestStore = async (store: Store) => ({
  tenantId: store.tenantId,
  userId: store.userId,
  accessToken: store.accessToken,
  branchId: store.device.branchId,
});

/** A role with these keys only, and a person holding it. */
async function personWith(store: Store, permissions: string[], phone: string, branchId?: string) {
  const key = `custom_${phone.slice(-4)}`;
  await ownerDb()`
    insert into roles (tenant_id, key, name, permissions, max_discount_bp, is_system)
    values (${store.tenantId}, ${key}, 'دور تجريبي', ${permissions}, 0, false)`;
  return staffUser(app, await asTestStore(store), key, phone, { branchId, fullName: 'مراقب' });
}

/**
 * A day on one device: a shift opened with 1,000 ل.س and 20 $, the golden sale, a card sale with
 * a tip and a rounded cash part, a pay-in, an expense, a drop to the safe, and a close 10 ل.س
 * short. Plus a sale of the next day.
 */
async function aDay(store: Store) {
  const doc = documents(store.device);
  const open = doc(
    'shift_open',
    shiftOpen(store.userId, [
      { currency: 'SYP', amountMinor: 100_000 },
      { currency: 'USD', amountMinor: 2_000 },
    ]),
  );
  const golden = doc('sale', goldenFirstSale(store, open.id));
  const second = doc(
    'sale',
    sale(store, open.id, {
      lines: [cartLine(1, 234_750)],
      tipMinor: 5_000,
      payments: [
        { method: 'card', currency: 'SYP', amountMinor: 100_000, reference: '731205', cardLast4: '4821' },
        { method: 'cash', currency: 'SYP', amountMinor: 150_000 },
      ],
      cashSteps: { SYP: 1000 },
    }),
  );
  const payIn = doc('cash_movement', movement(store.userId, open.id, 'pay_in', 50_000));
  const expense = doc('cash_movement', movement(store.userId, open.id, 'expense', 15_000));
  const drop = doc('cash_movement', movement(store.userId, open.id, 'safe_drop', 100_000));
  // SYP: 1,000 + 200 − 80 + 1,500 − 100 (change) + 500 − 150 − 1,000 = 1,870; counted 1,860.
  const secondPayload = second.payload as unknown as { change: { amountMinor: number } };
  const close = doc(
    'shift_close',
    shiftClose(store.userId, open.id, [
      {
        currency: 'SYP',
        opening: 100_000,
        cashIn: 170_000,
        changeOut: 8_000 + secondPayload.change.amountMinor,
        payIn: 50_000,
        payOut: 15_000,
        drops: 100_000,
        counted:
          100_000 + 170_000 - 8_000 - secondPayload.change.amountMinor + 50_000 - 15_000 - 100_000 - 1_000,
      },
      { currency: 'USD', opening: 2_000, cashIn: 900, counted: 2_900 },
    ]),
  );
  const nextDevice = await createDevice(store.tenantId);
  const tomorrow = documents(nextDevice, '2026-10-31');
  await push(app, store.device, [open, golden, second, payIn, expense, drop, close]);
  return { open, golden, second, close, tomorrow, nextDevice, change: secondPayload.change.amountMinor };
}

describe('GET /v1/reports/day', () => {
  it('sums the day’s invoices, payments by method net of change, and each cashier', async () => {
    const store = await openStore(app);
    const day = await aDay(store);
    expect(day.change).toBe(10_000);
    const res = await get(store.accessToken, '/v1/reports/day?date=2026-10-30');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<DayReport>()).toEqual({
      date: '2026-10-30',
      branchId: null,
      invoiceCount: 2,
      grossMinor: 135_000 + 234_750,
      discountMinor: 6_000,
      netExTaxMinor: 129_000 + 234_750,
      taxMinor: 0,
      totalMinor: 129_000 + 234_750,
      tipsMinor: 5_000,
      // 2,347.50 + 50 tip − 1,000 card = 1,397.50 in cash, rounded to 1,400: 2.50 gained.
      cashRoundingMinor: 250,
      byMethod: [
        {
          method: 'cash',
          currency: 'SYP',
          amountMinor: 12_000 + 140_000,
          baseAmountMinor: 152_000,
          count: 2,
        },
        { method: 'cash', currency: 'USD', amountMinor: 900, baseAmountMinor: 117_000, count: 1 },
        { method: 'card', currency: 'SYP', amountMinor: 100_000, baseAmountMinor: 100_000, count: 1 },
      ],
      byCashier: [{ userId: store.userId, fullName: 'أحمد الخطيب', invoiceCount: 2, totalMinor: 363_750 }],
      baseCurrency: 'SYP',
    });
  });

  it('filters by branch, refuses another store’s branch (404), and anyone without report.view (403)', async () => {
    const store = await openStore(app, '0911111111');
    const other = await openStore(app, '0922222222');
    await aDay(store);
    const own = await get(
      store.accessToken,
      `/v1/reports/day?date=2026-10-30&branchId=${store.device.branchId}`,
    );
    expect(own.json<DayReport>()).toMatchObject({ branchId: store.device.branchId, invoiceCount: 2 });
    const foreign = await get(
      other.accessToken,
      `/v1/reports/day?date=2026-10-30&branchId=${store.device.branchId}`,
    );
    expect(foreign.statusCode).toBe(404);
    expect(
      (await get(other.accessToken, '/v1/reports/day?date=2026-10-30')).json<DayReport>().invoiceCount,
    ).toBe(0);
    const cashier = await staffUser(app, await asTestStore(store), 'cashier', '0933333333');
    expect((await get(cashier.accessToken, '/v1/reports/day?date=2026-10-30')).statusCode).toBe(403);
    expect((await get(store.accessToken, '/v1/reports/day?date=30-10-2026')).statusCode).toBe(400);
  });

  it('limits a person whose role is for one branch to that branch', async () => {
    const store = await openStore(app);
    await aDay(store);
    const [second] = await ownerDb()<{ id: string }[]>`
      insert into branches (tenant_id, code, name) values (${store.tenantId}, '002', 'فرع ثان') returning id`;
    const local = await personWith(store, ['report.view'], '0944444444', second!.id);
    expect(
      (await get(local.accessToken, '/v1/reports/day?date=2026-10-30')).json<DayReport>().invoiceCount,
    ).toBe(0);
    const res = await get(
      local.accessToken,
      `/v1/reports/day?date=2026-10-30&branchId=${store.device.branchId}`,
    );
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /v1/shifts and /v1/shifts/{id}', () => {
  it('lists the day’s shifts with their sales', async () => {
    const store = await openStore(app);
    const { open } = await aDay(store);
    const res = await get(store.accessToken, '/v1/shifts?date=2026-10-30');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<ShiftListResponse>().items).toEqual([
      {
        id: open.id,
        number: open.number,
        branchId: store.device.branchId,
        deviceCode: store.device.code,
        openedBy: { id: store.userId, fullName: 'أحمد الخطيب' },
        openedAt: '2026-10-30T08:59:00.000Z',
        closedAt: '2026-10-30T08:59:00.000Z',
        status: 'closed',
        salesCount: 2,
        salesTotalMinor: 363_750,
      },
    ]);
    expect(
      (await get(store.accessToken, '/v1/shifts?date=2026-10-29')).json<ShiftListResponse>().items,
    ).toEqual([]);
  });

  it('reports each drawer by the formula of tab 10, the methods and the movements with their approver', async () => {
    const store = await openStore(app);
    const { open, change } = await aDay(store);
    const res = await get(store.accessToken, `/v1/shifts/${open.id}`);
    expect(res.statusCode, res.body).toBe(200);
    const report = res.json<ShiftReport>();
    const expectedSyp = 100_000 + 170_000 - 8_000 - change + 50_000 - 15_000 - 100_000;
    expect(report.byCurrency).toEqual([
      {
        currency: 'SYP',
        openingMinor: 100_000,
        cashSalesMinor: 170_000,
        changeGivenMinor: 8_000 + change,
        payInMinor: 50_000,
        payOutMinor: 15_000,
        dropsMinor: 100_000,
        expectedMinor: expectedSyp,
        countedMinor: expectedSyp - 1_000,
        differenceMinor: -1_000,
      },
      {
        currency: 'USD',
        openingMinor: 2_000,
        cashSalesMinor: 900,
        changeGivenMinor: 0,
        payInMinor: 0,
        payOutMinor: 0,
        dropsMinor: 0,
        expectedMinor: 2_900,
        countedMinor: 2_900,
        differenceMinor: 0,
      },
    ]);
    expect(report.byMethod).toEqual([
      { method: 'cash', currency: 'SYP', amountMinor: 170_000 - 8_000 - change, count: 2 },
      { method: 'cash', currency: 'USD', amountMinor: 900, count: 1 },
      { method: 'card', currency: 'SYP', amountMinor: 100_000, count: 1 },
    ]);
    expect(report.movements.map((m) => [m.kind, m.amountMinor, m.approvedBy?.fullName, m.reason])).toEqual([
      ['pay_in', 50_000, 'أحمد الخطيب', 'فكة'],
      ['expense', 15_000, 'أحمد الخطيب', 'فاتورة كهرباء'],
      ['safe_drop', 100_000, 'أحمد الخطيب', 'فكة'],
    ]);
  });

  it('hides the expected amount and the difference without shift.view_difference', async () => {
    const store = await openStore(app);
    const { open } = await aDay(store);
    const viewer = await personWith(store, ['report.view'], '0955555555');
    const report = (await get(viewer.accessToken, `/v1/shifts/${open.id}`)).json<ShiftReport>();
    expect(
      report.byCurrency.map((c) => [c.expectedMinor, c.countedMinor !== null, c.differenceMinor]),
    ).toEqual([
      [null, true, null],
      [null, true, null],
    ]);
    const cashier = await staffUser(app, await asTestStore(store), 'cashier', '0966666666');
    expect((await get(cashier.accessToken, `/v1/shifts/${open.id}`)).statusCode).toBe(403);
    expect((await get(cashier.accessToken, '/v1/shifts')).statusCode).toBe(403);
    expect((await get(store.accessToken, '/v1/shifts/not-an-id')).statusCode).toBe(404);
    expect((await get(store.accessToken, `/v1/shifts/${newId()}`)).statusCode).toBe(404);
  });

  it('shows an open shift (X) without counted amounts, and a close that came alone without its opener', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    await push(app, store.device, [open, doc('sale', goldenFirstSale(store, open.id))]);
    const x = (await get(store.accessToken, `/v1/shifts/${open.id}`)).json<ShiftReport>();
    expect(x.status).toBe('open');
    expect(x.byCurrency.find((c) => c.currency === 'SYP')).toMatchObject({
      expectedMinor: 112_000,
      countedMinor: null,
      differenceMinor: null,
    });
    const lone = newId();
    await push(app, store.device, [
      doc(
        'shift_close',
        shiftClose(store.userId, lone, [{ currency: 'SYP', opening: 5_000, counted: 5_000 }]),
      ),
    ]);
    const report = (await get(store.accessToken, `/v1/shifts/${lone}`)).json<ShiftReport>();
    expect(report).toMatchObject({ openedBy: null, openedAt: null, status: 'closed' });
    expect(report.byCurrency[0]).toMatchObject({
      openingMinor: 5_000,
      expectedMinor: 5_000,
      differenceMinor: 0,
    });
  });
});

describe('GET /v1/accounts, /v1/journal and /v1/reports/trial-balance', () => {
  it('lists the chart as a tree by parent code', async () => {
    const store = await openStore(app);
    const res = await get(store.accessToken, '/v1/accounts');
    expect(res.statusCode).toBe(200);
    const items = res.json<AccountListResponse>().items;
    expect(items.find((a) => a.code === '111002')).toEqual({
      id: expect.any(String),
      code: '111002',
      name: 'الصندوق — دولار أمريكي',
      nameEn: 'Cash drawers — US dollar',
      type: 'asset',
      parentCode: '1110',
      isGroup: false,
      isSystem: true,
      currency: 'USD',
    });
    expect(items.find((a) => a.code === '1')).toMatchObject({ parentCode: null, isGroup: true });
    const cashier = await staffUser(app, await asTestStore(store), 'cashier', '0933333333');
    expect((await get(cashier.accessToken, '/v1/accounts')).statusCode).toBe(403);
  });

  it('pages the journal in number order with each entry’s lines and source', async () => {
    const store = await openStore(app);
    const { golden, close } = await aDay(store);
    const first = await get(store.accessToken, '/v1/journal?from=2026-10-30&to=2026-10-30&limit=2');
    expect(first.statusCode, first.body).toBe(200);
    const page = first.json<JournalPage>();
    expect(page.items.map((e) => e.number)).toEqual(['2026-0000001', '2026-0000002']);
    expect(page.items[0]).toEqual({
      id: expect.any(String),
      number: '2026-0000001',
      date: '2026-10-30',
      source: { type: 'sale', id: golden.id, number: golden.number },
      memo: `فاتورة مبيعات ${golden.number}`,
      lines: [
        {
          accountCode: '111002',
          accountName: 'الصندوق — دولار أمريكي',
          debitMinor: 117_000,
          creditMinor: 0,
          currency: 'USD',
          amountMinor: 900,
          rate: { unit: 'USD', quote: 'SYP', rate: '130' },
        },
        {
          accountCode: '111001',
          accountName: 'الصندوق — ليرة سورية',
          debitMinor: 12_000,
          creditMinor: 0,
          currency: 'SYP',
          amountMinor: 12_000,
          rate: null,
        },
        {
          accountCode: '4200',
          accountName: 'الحسميات الممنوحة',
          debitMinor: 6_000,
          creditMinor: 0,
          currency: 'SYP',
          amountMinor: 6_000,
          rate: null,
        },
        {
          accountCode: '4100',
          accountName: 'المبيعات',
          debitMinor: 0,
          creditMinor: 135_000,
          currency: 'SYP',
          amountMinor: 135_000,
          rate: null,
        },
      ],
      totalMinor: 135_000,
    });
    const rest: JournalPage['items'] = [];
    let cursor = page.nextCursor;
    while (cursor) {
      const next = (await get(store.accessToken, `/v1/journal?limit=2&cursor=${cursor}`)).json<JournalPage>();
      rest.push(...next.items);
      cursor = next.nextCursor;
    }
    expect(rest.map((e) => e.source.type)).toEqual([
      'cash_movement',
      'cash_movement',
      'cash_movement',
      'shift_close',
    ]);
    expect(rest.at(-1)!.source).toEqual({ type: 'shift_close', id: close.id, number: 'SFT-001-002-0000001' });
    expect((await get(store.accessToken, '/v1/journal?from=2026-10-31')).json<JournalPage>().items).toEqual(
      [],
    );
    expect((await get(store.accessToken, '/v1/journal?cursor=bad')).statusCode).toBe(400);
  });

  it('balances the trial balance, signing each account by its normal side', async () => {
    const store = await openStore(app);
    const { tomorrow, nextDevice } = await aDay(store);
    const res = await get(store.accessToken, '/v1/reports/trial-balance?from=2026-10-30&to=2026-10-30');
    expect(res.statusCode, res.body).toBe(200);
    const tb = res.json<TrialBalance>();
    expect(tb.balanced).toBe(true);
    expect(tb.totals.debitMinor).toBe(tb.totals.creditMinor);
    const row = (code: string) => tb.rows.find((r) => r.accountCode === code);
    expect(row('4100')).toMatchObject({
      type: 'revenue',
      openingMinor: 0,
      creditMinor: 369_750,
      closingMinor: 369_750,
    });
    expect(row('4200')).toMatchObject({ debitMinor: 6_000, closingMinor: 6_000 });
    expect(row('6200')).toMatchObject({ debitMinor: 1_000, closingMinor: 1_000 });
    expect(row('6400')).toMatchObject({ creditMinor: 250, closingMinor: -250 });
    expect(row('2550')).toMatchObject({ type: 'liability', closingMinor: 5_000 });
    expect(row('6102')).toMatchObject({ closingMinor: 15_000 });

    // The next day opens with the first day's balances.
    await push(app, nextDevice, [tomorrow('sale', goldenFirstSale(store, newId()))]);
    const next = (
      await get(store.accessToken, '/v1/reports/trial-balance?from=2026-10-31&to=2026-10-31')
    ).json<TrialBalance>();
    expect(next.balanced).toBe(true);
    expect(next.rows.find((r) => r.accountCode === '4100')).toMatchObject({
      openingMinor: 369_750,
      creditMinor: 135_000,
      closingMinor: 504_750,
    });
    expect(
      (await get(store.accessToken, '/v1/reports/trial-balance?from=2026-10-31&to=2026-10-30')).statusCode,
    ).toBe(400);
  });
});

describe('GET /v1/sync/evidence (23 › شاشة الدليل)', () => {
  it('counts what a device sent, the duplicates, and compares its last announced and received numbers', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sales = [1, 2, 3, 4, 5].map(() => doc('sale', goldenFirstSale(store, open.id)));
    await push(app, store.device, [open, ...sales]);
    // Sent again in full: duplicates, and nothing changes.
    await push(app, store.device, sales);
    // The device says it issued a sixth invoice that has not arrived: the screen shows the gap.
    const beat = await app.inject({
      method: 'POST',
      url: '/v1/sync/heartbeat',
      headers: { authorization: store.device.authorization },
      payload: {
        contractVersion: 1,
        appVersion: '1.0.0',
        sentAt: '2026-10-30T09:00:00.000Z',
        lastIssued: { INV: 6, SFT: 1 },
        unsentCount: 1,
      },
    });
    expect(beat.statusCode, beat.body).toBe(200);
    const res = await get(
      store.accessToken,
      `/v1/sync/evidence?deviceId=${store.device.deviceId}&date=2026-10-30`,
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<SyncEvidence>()).toEqual({
      deviceId: store.device.deviceId,
      deviceName: `كاشير ${store.device.code}`,
      sent: 6,
      accepted: 6,
      duplicate: 5,
      rejected: 0,
      quarantined: 0,
      lastAnnouncedNumber: {
        INV: `INV-001-${store.device.code}-0000006`,
        SFT: `SFT-001-${store.device.code}-0000001`,
      },
      lastReceivedNumber: {
        INV: `INV-001-${store.device.code}-0000005`,
        SFT: `SFT-001-${store.device.code}-0000001`,
      },
    });
    const [entries] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from journal_entries`;
    expect(entries!.n).toBe(5);
  });

  it('answers 404 for another store’s device and 403 without devices.view', async () => {
    const store = await openStore(app, '0911111111');
    const other = await openStore(app, '0922222222');
    const url = `/v1/sync/evidence?deviceId=${store.device.deviceId}`;
    expect((await get(other.accessToken, url)).statusCode).toBe(404);
    const cashier = await staffUser(app, await asTestStore(store), 'cashier', '0933333333');
    expect((await get(cashier.accessToken, url)).statusCode).toBe(403);
    expect((await get(store.accessToken, url)).statusCode).toBe(200);
  });
});
