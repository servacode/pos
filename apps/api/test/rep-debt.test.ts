import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  ProductDetail,
  RepDebt,
  RepDebtBalance,
  RepRow,
  RepSettlementDetail,
  SettlementPreview,
  VanRow,
} from '@serva/core';
import { hashDeviceToken } from '../src/auth/device-guard';
import {
  createUuidV7,
  formatDocNumber,
  payloadHash,
  seriesOf,
  type DocType,
  type SyncDocument,
} from '@serva/sync';
import {
  cartLine,
  DATE,
  movement,
  postedEntries,
  push,
  sale,
  shiftClose,
  shiftOpen,
} from './accounting-fixtures';
import { type TestDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase, settled } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

/**
 * «ذمة المندوب» (round 35, D6): a cash shortage found at the evening settlement becomes the rep's debt in 1250
 * instead of staying the shop's cash-difference loss. Approval MOVES what the shift close booked (6200) onto
 * the rep, and books anything the rep's own count did not show against the drawer, so the loss is never
 * counted twice and the trial balance stays balanced. The rep pays it back (cash into the safe) or the owner
 * forgives it (back to the loss). A settlement with no shortage, or left as the shop's loss, posts nothing.
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

type Method = 'GET' | 'POST';
const call = (token: string, method: Method, url: string, payload?: unknown) =>
  app.inject({ method, url, headers: bearer(token), ...(payload ? { payload: payload as object } : {}) });
const ok = async <T>(token: string, method: Method, url: string, payload?: unknown, status = 200) => {
  const res = await call(token, method, url, payload);
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(status);
  return res.json<T>();
};

const newId = createUuidV7();

/** Documents as a rep phone makes them: numbered in its van's branch */
function documents(device: TestDevice, branchCode: string) {
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
      deviceTime: `${DATE}T08:59:00.000Z`,
      businessDate: DATE,
      deviceOffsetMs: 0,
      engineVersion: '1.0.0',
      contractVersion: 1,
      deps: [],
      payload: payload as Record<string, unknown>,
    };
    return { ...body, hash: payloadHash(body) };
  };
}

interface World {
  rep: RepRow;
  repUserId: string;
  van: VanRow;
}

/**
 * A rep with a van and a phone. His day: a shift opened with 100,000, 200,000 of cash sales, 150,000 dropped into
 * the safe, and the shift closed counting `closeCounted` in the drawer (expected 150,000). So the settlement
 * expects 300,000 from him, and a close counting 140,000 booked a 10,000 shortage as a cash-difference loss.
 */
async function world(closeCounted: number, dollars?: { opening: number; counted: number }): Promise<World> {
  const owner = bearer(s.accessToken);
  const product = (
    await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: owner,
      payload: { nameAr: 'قميص', variants: [{ price: { currency: 'SYP', priceMinor: 100_000 } }] },
    })
  ).json<ProductDetail>();
  const van = await ok<VanRow>(
    s.accessToken,
    'POST',
    '/v1/vans',
    { name: 'سيارة 1', parentBranchId: s.branchId },
    201,
  );
  const staff = await staffUser(app, s, 'rep', '0955000001', { fullName: 'مندوب 1' });
  const rep = await ok<RepRow>(
    s.accessToken,
    'POST',
    '/v1/reps',
    { userId: staff.userId, branchId: s.branchId, vanBranchId: van.id },
    201,
  );
  const token = `sdt_${randomBytes(32).toString('base64url')}`;
  const [row] = await ownerDb()<{ id: string }[]>`
    insert into devices (tenant_id, branch_id, code, name, kind, status, token_hash)
    values (${s.tenantId}, ${van.id}, '002', 'هاتف 002', 'rep_phone', 'active', ${hashDeviceToken(token)})
    returning id`;
  const phone: TestDevice = {
    deviceId: row!.id,
    tenantId: s.tenantId,
    branchId: van.id,
    code: '002',
    token,
    authorization: `Device ${token}`,
  };
  const [vanBranch] = await ownerDb()<{ code: string }[]>`select code from branches where id = ${van.id}`;
  const doc = documents(phone, vanBranch!.code);
  const open = doc(
    'shift_open',
    shiftOpen(staff.userId, [
      { currency: 'SYP', amountMinor: 100_000 },
      ...(dollars ? [{ currency: 'USD', amountMinor: dollars.opening }] : []),
    ]),
  );
  const docs = [
    open,
    doc(
      'sale',
      sale({ userId: staff.userId }, open.id, {
        lines: [
          cartLine(1, 100_000, {
            productId: product.id,
            variantId: product.variants[0]!.id,
            qty: 2000,
            name: 'قميص',
          }),
        ],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 200_000 }],
      }),
    ),
    doc('cash_movement', movement(staff.userId, open.id, 'safe_drop', 150_000)),
    doc(
      'shift_close',
      shiftClose(staff.userId, open.id, [
        { currency: 'SYP', opening: 100_000, cashIn: 200_000, drops: 150_000, counted: closeCounted },
        ...(dollars
          ? [{ currency: 'USD' as const, opening: dollars.opening, counted: dollars.counted }]
          : []),
      ]),
    ),
  ];
  const pushed = await push(app, phone, docs);
  expect(pushed.results.map((r) => r.status)).toEqual(docs.map(() => 'accepted'));
  await settled();
  return { rep, repUserId: staff.userId, van };
}

const settle = (
  w: World,
  countedCash: number | Record<string, number>,
  treatment?: 'rep_debt' | 'shop_loss' | null,
  token = s.accessToken,
) =>
  ok<RepSettlementDetail>(
    token,
    'POST',
    '/v1/rep-settlements',
    {
      repId: w.rep.id,
      businessDate: DATE,
      countedCash: typeof countedCash === 'number' ? { SYP: countedCash } : countedCash,
      treatment,
    },
    201,
  );

const approve = (made: RepSettlementDetail, token = s.accessToken) =>
  ok<RepSettlementDetail>(token, 'POST', `/v1/rep-settlements/${made.id}/approve`, { version: made.version });

const balanceOf = async (code: string) =>
  Number(
    (
      await ownerDb()<{ b: string | null }[]>`
        select sum(l.debit_minor - l.credit_minor)::text as b
        from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
        where l.tenant_id = ${s.tenantId} and a.code like ${code}`
    )[0]!.b ?? 0,
  );

/** The books balance: the trial balance sums to nothing, and no entry is out of balance */
async function expectTrialBalance() {
  const [sum] = await ownerDb()<{ d: string; c: string }[]>`
    select sum(debit_minor)::text as d, sum(credit_minor)::text as c from journal_lines where tenant_id = ${s.tenantId}`;
  expect(sum!.d).toBe(sum!.c);
  const [bad] = await ownerDb()<{ n: string }[]>`
    select count(*)::text as n from (
      select entry_id from journal_lines where tenant_id = ${s.tenantId}
      group by entry_id having sum(debit_minor) <> sum(credit_minor)) x`;
  expect(bad!.n).toBe('0');
}

const entryOf = async (sourceType: string) =>
  (await postedEntries(s.tenantId)).filter((e) => e.sourceType === sourceType);

describe('a shortage at the settlement', () => {
  it('moves what the shift close booked as a loss onto the rep, and the loss is not counted twice', async () => {
    const w = await world(140_000);
    // The shift close alone: a 10,000 shortage was the shop's cash-difference loss
    expect(await balanceOf('6200')).toBe(10_000);
    expect(await balanceOf('1250')).toBe(0);

    const made = await settle(w, 290_000);
    expect(made).toMatchObject({ cashDifference: { SYP: -10_000 }, repDebt: null });
    // Drafting posts nothing
    expect(await entryOf('rep_settlement')).toEqual([]);

    const done = await approve(made);
    expect(done.status).toBe('approved');
    expect(done.repDebt).toMatchObject({ shortage: { SYP: 10_000 }, baseMinor: 10_000 });
    const [entry] = await entryOf('rep_settlement');
    expect(entry!.lines.map((l) => [l.code, l.debit, l.credit])).toEqual([
      ['1250', 10_000, 0],
      ['6200', 0, 10_000],
    ]);
    expect(done.repDebt!.entryNumber).toBe(entry!.number);
    // The loss moved to the rep: 6200 nets to nothing, the rep owes it, the drawer is untouched
    expect(await balanceOf('6200')).toBe(0);
    expect(await balanceOf('1250')).toBe(10_000);
    const [line] = await ownerDb()<{ party_type: string; party_id: string }[]>`
      select l.party_type, l.party_id from journal_lines l join accounts a on a.id = l.account_id
      where a.code = '1250' and l.tenant_id = ${s.tenantId}`;
    expect(line).toEqual({ party_type: 'user', party_id: w.repUserId });
    expect(await balanceOf('1110%')).toBe(40_000);
    await expectTrialBalance();

    // His page and the list show the balance; the next preview shows it too
    const debt = await ok<RepDebt>(s.accessToken, 'GET', `/v1/reps/${w.rep.id}/debt`);
    expect(debt).toMatchObject({ repName: 'مندوب 1', balanceMinor: 10_000 });
    expect(debt.entries).toEqual([
      expect.objectContaining({ kind: 'shortage', amountMinor: 10_000, number: entry!.number }),
    ]);
    expect(await ok<RepDebtBalance[]>(s.accessToken, 'GET', '/v1/rep-debts')).toEqual([
      { repId: w.rep.id, repName: 'مندوب 1', balanceMinor: 10_000 },
    ]);
    const next = await ok<SettlementPreview>(
      s.accessToken,
      'GET',
      `/v1/rep-settlements/preview?repId=${w.rep.id}&date=${DATE}`,
    );
    expect(next.repDebtMinor).toBe(10_000);
    // The record keeps what it moved
    const read = await ok<RepSettlementDetail>(s.accessToken, 'GET', `/v1/rep-settlements/${made.id}`);
    expect(read.repDebt).toMatchObject({ baseMinor: 10_000 });
  });

  it('also takes what the supervisor found missing beyond the loss the close booked, out of the drawer', async () => {
    const w = await world(140_000);
    const done = await approve(await settle(w, 280_000));
    expect(done.repDebt).toMatchObject({ shortage: { SYP: 20_000 }, baseMinor: 20_000 });
    const [entry] = await entryOf('rep_settlement');
    expect(entry!.lines.map((l) => [l.code, l.debit, l.credit])).toEqual([
      ['1250', 20_000, 0],
      ['111001', 0, 10_000],
      ['6200', 0, 10_000],
    ]);
    expect(await balanceOf('6200')).toBe(0);
    expect(await balanceOf('1250')).toBe(20_000);
    // The drawer lost the other 10,000 too: it was short at the supervisor's count, not at the close
    expect(await balanceOf('1110%')).toBe(30_000);
    await expectTrialBalance();
  });

  it('turns a dollar shortage into pounds at the rate the close used, and what the close did not see at the shop rate', async () => {
    // 100 $ in the drawer at the start, 90 $ counted at the close: a 10 $ shortage at 130, booked as 130,000 loss
    const w = await world(150_000, { opening: 10_000, counted: 9_000 });
    expect(await balanceOf('6200')).toBe(130_000);
    // The shop's rate is 125 today, not the 130 the close used
    await ownerDb()`
      insert into exchange_rates (tenant_id, unit, quote, rate) values (${s.tenantId}, 'USD', 'SYP', '125')`;
    const shop = 125;
    // The supervisor counts 80 $: 10 $ more is missing than the close saw
    const done = await approve(await settle(w, { SYP: 300_000, USD: 8_000 }));
    expect(done.repDebt).toMatchObject({ shortage: { USD: 2_000 }, baseMinor: 130_000 + 1_000 * shop });
    const [entry] = await entryOf('rep_settlement');
    expect(entry!.lines.map((l) => [l.code, l.debit, l.credit])).toEqual([
      ['1250', 130_000 + 1_000 * shop, 0],
      ['111002', 0, 1_000 * shop],
      ['6200', 0, 130_000],
    ]);
    expect(entry!.lines.find((l) => l.code === '111002')).toMatchObject({ currency: 'USD', amount: -1_000 });
    expect(await balanceOf('6200')).toBe(0);
    expect(await balanceOf('1250')).toBe(130_000 + 1_000 * shop);
    await expectTrialBalance();
  });

  it('leaves the loss with the shop when the supervisor chose so, and posts nothing without a shortage', async () => {
    const lossy = await world(140_000);
    const done = await approve(await settle(lossy, 290_000, 'shop_loss'));
    expect(done.repDebt).toBeNull();
    expect(await entryOf('rep_settlement')).toEqual([]);
    expect(await balanceOf('6200')).toBe(10_000);
    expect(await balanceOf('1250')).toBe(0);
    await expectTrialBalance();
  });

  it('posts nothing when the cash is all there, or more than it should be', async () => {
    const w = await world(150_000);
    const before = (await postedEntries(s.tenantId)).length;
    const done = await approve(await settle(w, 305_000));
    expect(done.repDebt).toBeNull();
    expect((await postedEntries(s.tenantId)).length).toBe(before);
    expect(await balanceOf('1250')).toBe(0);
    expect(await ok<RepDebtBalance[]>(s.accessToken, 'GET', '/v1/rep-debts')).toEqual([]);
    await expectTrialBalance();
  });

  it('is posted once: an approved settlement cannot be approved again', async () => {
    const w = await world(140_000);
    const made = await settle(w, 290_000);
    await approve(made);
    const again = await call(s.accessToken, 'POST', `/v1/rep-settlements/${made.id}/approve`, { version: 2 });
    expect(again.statusCode).toBe(409);
    expect(await entryOf('rep_settlement')).toHaveLength(1);
    expect(await balanceOf('1250')).toBe(10_000);
  });
});

describe('settling what the rep owes', () => {
  it('takes cash from the rep into the safe, down to nothing, and refuses more than he owes', async () => {
    const w = await world(140_000);
    await approve(await settle(w, 280_000));
    expect(await balanceOf('1250')).toBe(20_000);
    const safeBefore = await balanceOf('1120%');

    const paid = await ok<RepDebt>(s.accessToken, 'POST', `/v1/reps/${w.rep.id}/debt/payments`, {
      amountMinor: 8_000,
      note: 'دفعة أولى',
    });
    expect(paid.balanceMinor).toBe(12_000);
    expect(paid.entries[0]).toMatchObject({ kind: 'payment', amountMinor: -8_000 });
    const [entry] = await entryOf('rep_debt');
    expect(entry!.lines.map((l) => [l.code, l.debit, l.credit])).toEqual([
      ['112001', 8_000, 0],
      ['1250', 0, 8_000],
    ]);
    expect(await balanceOf('1120%')).toBe(safeBefore + 8_000);

    const over = await call(s.accessToken, 'POST', `/v1/reps/${w.rep.id}/debt/payments`, {
      amountMinor: 12_001,
    });
    expect(over.statusCode).toBe(400);
    const rest = await ok<RepDebt>(s.accessToken, 'POST', `/v1/reps/${w.rep.id}/debt/payments`, {
      amountMinor: 12_000,
    });
    expect(rest.balanceMinor).toBe(0);
    // Nothing is owed any more: a further payment is refused
    expect(
      (await call(s.accessToken, 'POST', `/v1/reps/${w.rep.id}/debt/payments`, { amountMinor: 1 }))
        .statusCode,
    ).toBe(409);
    expect(await ok<RepDebtBalance[]>(s.accessToken, 'GET', '/v1/rep-debts')).toEqual([]);
    await expectTrialBalance();
  });

  it('is forgiven by the owner alone, and the amount goes back to the shop loss', async () => {
    const w = await world(140_000);
    await approve(await settle(w, 290_000));
    const supervisor = await staffUser(app, s, 'sales_supervisor', '0955000002');
    // A supervisor may settle but not forgive: that is a loss decision, the owner's
    expect(
      (
        await call(supervisor.accessToken, 'POST', `/v1/reps/${w.rep.id}/debt/forgive`, {
          amountMinor: 4_000,
          reason: 'ظرف خاص',
        })
      ).statusCode,
    ).toBe(403);
    expect(await balanceOf('1250')).toBe(10_000);

    const forgiven = await ok<RepDebt>(s.accessToken, 'POST', `/v1/reps/${w.rep.id}/debt/forgive`, {
      amountMinor: 4_000,
      reason: 'ظرف خاص',
    });
    expect(forgiven.balanceMinor).toBe(6_000);
    expect(forgiven.entries[0]).toMatchObject({ kind: 'forgiven', amountMinor: -4_000 });
    const [entry] = await entryOf('rep_debt');
    expect(entry!.lines.map((l) => [l.code, l.debit, l.credit])).toEqual([
      ['6200', 4_000, 0],
      ['1250', 0, 4_000],
    ]);
    // 10,000 moved off the loss, 4,000 came back to it
    expect(await balanceOf('6200')).toBe(4_000);
    await expectTrialBalance();
    // The reason is on the audit trail
    const [audit] = await ownerDb()<{ reason: string | null }[]>`
      select reason from audit_logs where tenant_id = ${s.tenantId} and action = 'rep_debt.forgive'`;
    expect(audit!.reason).toBe('ظرف خاص');
  });

  it('is the supervisor’s to take and to see, and no other store’s', async () => {
    const w = await world(140_000);
    await approve(await settle(w, 290_000));
    const supervisor = await staffUser(app, s, 'sales_supervisor', '0955000003');
    const cashier = await staffUser(app, s, 'cashier', '0955000004');
    expect((await call(supervisor.accessToken, 'GET', `/v1/reps/${w.rep.id}/debt`)).statusCode).toBe(200);
    expect(
      (
        await call(supervisor.accessToken, 'POST', `/v1/reps/${w.rep.id}/debt/payments`, {
          amountMinor: 1_000,
        })
      ).statusCode,
    ).toBe(200);
    for (const [method, url] of [
      ['GET', `/v1/reps/${w.rep.id}/debt`],
      ['GET', '/v1/rep-debts'],
    ] as const) {
      expect((await call(cashier.accessToken, method, url)).statusCode, url).toBe(403);
    }
    const other = await testStore(app, '0922222222');
    expect((await call(other.accessToken, 'GET', `/v1/reps/${w.rep.id}/debt`)).statusCode).toBe(404);
    expect(
      (await call(other.accessToken, 'POST', `/v1/reps/${w.rep.id}/debt/payments`, { amountMinor: 1_000 }))
        .statusCode,
    ).toBe(404);
    await expectTrialBalance();
  });
});
