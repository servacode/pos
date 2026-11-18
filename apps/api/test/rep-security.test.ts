import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  ProductDetail,
  RepRow,
  RepSettlementDetail,
  SettlementPreview,
  StaffSessionResponse,
  SupplierRow,
  VanRow,
} from '@serva/core';
import {
  createUuidV7,
  formatDocNumber,
  payloadHash,
  seriesOf,
  type DocType,
  type SyncDocument,
} from '@serva/sync';
import { hashDeviceToken } from '../src/auth/device-guard';
import { balances, DATE, movement, push, shiftClose, shiftOpen } from './accounting-fixtures';
import { createDevice, type TestDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase, settled } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

/**
 * Round 35, the owner's approved changes in security and permissions:
 * D3 a rep's phone takes only the rep of its van, a manager and the owner;
 * D2 the sales supervisor may move cash and approve stock (the settlement's van count and transfer);
 * D5 the rep's shift opens at 0 and his float is the till's own pay-in from the safe.
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

let phoneSeq = 0;
const phone = () => `0955${String(++phoneSeq).padStart(6, '0')}`;

async function repPhone(tenantId: string, branchId: string, code: string): Promise<TestDevice> {
  const token = `sdt_${randomBytes(32).toString('base64url')}`;
  const [row] = await ownerDb()<{ id: string }[]>`
    insert into devices (tenant_id, branch_id, code, name, kind, status, token_hash)
    values (${tenantId}, ${branchId}, ${code}, ${`هاتف ${code}`}, 'rep_phone', 'active', ${hashDeviceToken(token)})
    returning id`;
  return { deviceId: row!.id, tenantId, branchId, code, token, authorization: `Device ${token}` };
}

const signIn = (device: TestDevice, userId: string, pin: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/device/staff-sessions',
    headers: { authorization: device.authorization },
    payload: { userId, pin },
  });

const setPin = (token: string, pin: string, password = 'secret-pass-2') =>
  app.inject({ method: 'PUT', url: '/v1/me/pin', headers: bearer(token), payload: { pin, password } });

async function withPin(role: string, pin: string, options: { branchId?: string | null } = {}) {
  const user = await staffUser(app, s, role, phone(), options);
  expect((await setPin(user.accessToken, pin)).statusCode).toBe(204);
  return user;
}

async function van(tag: string): Promise<VanRow> {
  return ok<VanRow>(
    s.accessToken,
    'POST',
    '/v1/vans',
    { name: `سيارة ${tag}`, parentBranchId: s.branchId },
    201,
  );
}

async function repOn(vanRow: VanRow, pin: string): Promise<{ userId: string; rep: RepRow }> {
  const user = await withPin('rep', pin);
  const rep = await ok<RepRow>(
    s.accessToken,
    'POST',
    '/v1/reps',
    { userId: user.userId, branchId: s.branchId, vanBranchId: vanRow.id },
    201,
  );
  return { userId: user.userId, rep };
}

describe('D3: who may sign in on a rep’s phone', () => {
  it('takes the rep of its van, a manager and the owner, and refuses everyone else with an Arabic 403', async () => {
    const v1 = await van('1');
    const v2 = await van('2');
    const mine = await repOn(v1, '482913');
    const other = await repOn(v2, '395714');
    const cashier = await withPin('cashier', '2846');
    const manager = await withPin('manager', '285713');
    const supervisor = await withPin('sales_supervisor', '285713');
    await setPin(s.accessToken, '491627', 'secret-pass-1');
    const device = await repPhone(s.tenantId, v1.id, '002');

    const own = await signIn(device, mine.userId, '482913');
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json<StaffSessionResponse>().roles.map((r) => r.key)).toEqual(['rep']);
    expect((await signIn(device, manager.userId, '285713')).statusCode).toBe(200);
    expect((await signIn(device, s.userId, '491627')).statusCode).toBe(200);

    for (const [who, pin] of [
      [other.userId, '395714'],
      [cashier.userId, '2846'],
      [supervisor.userId, '285713'],
    ] as const) {
      const res = await signIn(device, who, pin);
      expect(res.statusCode, who).toBe(403);
      expect(res.json().error.code).toBe('forbidden');
      expect(res.json().error.message).toBe(
        'هذا جوال مندوب. يدخل عليه مندوب سيارته أو المدير أو المالك فقط.',
      );
    }
    // The refusal is written down, and a right PIN that was refused is not a failure that locks him
    const [log] = await ownerDb()<{ n: number }[]>`
      select count(*)::int as n from audit_logs where action = 'staff_session.refused'`;
    expect(log!.n).toBe(3);
    const [failed] = await ownerDb()<{ n: number }[]>`
      select count(*)::int as n from audit_logs where action = 'staff_session.failed'`;
    expect(failed!.n).toBe(0);
  });

  it('still answers a wrong PIN with 401, so a refused name cannot be told from a wrong code', async () => {
    const v1 = await van('1');
    const cashier = await withPin('cashier', '2846');
    const device = await repPhone(s.tenantId, v1.id, '002');
    const res = await signIn(device, cashier.userId, '9999');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('pin_invalid');
  });

  it('refuses a rep who was stopped, and a rep whose van is another', async () => {
    const v1 = await van('1');
    const mine = await repOn(v1, '482913');
    const device = await repPhone(s.tenantId, v1.id, '002');
    expect((await signIn(device, mine.userId, '482913')).statusCode).toBe(200);
    await ownerDb()`update sales_reps set status = 'stopped' where id = ${mine.rep.id}`;
    expect((await signIn(device, mine.userId, '482913')).statusCode).toBe(403);
  });

  it('leaves a normal till exactly as it was: a cashier, a rep and a supervisor all sign in', async () => {
    const till = await createDevice(s.tenantId);
    const v1 = await van('1');
    const rep = await repOn(v1, '482913');
    const cashier = await withPin('cashier', '2846');
    const supervisor = await withPin('sales_supervisor', '285713');
    for (const [who, pin] of [
      [cashier.userId, '2846'],
      [rep.userId, '482913'],
      [supervisor.userId, '285713'],
    ] as const) {
      expect((await signIn(till, who, pin)).statusCode, who).toBe(200);
    }
  });
});

describe('D2: the sales supervisor’s permissions', () => {
  it('holds cash.move and inventory.adjust, in the role of a new store and in the sign-in answer', async () => {
    const [role] = await ownerDb()<{ permissions: string[] }[]>`
      select permissions from roles where tenant_id = ${s.tenantId} and key = 'sales_supervisor'`;
    expect(role!.permissions).toEqual(
      expect.arrayContaining(['cash.move', 'inventory.adjust', 'rep.settle']),
    );
    const supervisor = await withPin('sales_supervisor', '285713');
    const till = await createDevice(s.tenantId);
    const res = await signIn(till, supervisor.userId, '285713');
    expect(res.json<StaffSessionResponse>().permissions).toEqual(
      expect.arrayContaining(['cash.move', 'inventory.adjust']),
    );
  });

  it('gives the two permissions to the role of a store that existed before, once, and keeps the rest', async () => {
    const before = await ownerDb()<{ permissions: string[] }[]>`
      select permissions from roles where tenant_id = ${s.tenantId} and key = 'sales_supervisor'`;
    await ownerDb()`
      update roles set permissions = array_remove(array_remove(permissions, 'cash.move'), 'inventory.adjust')
      where tenant_id = ${s.tenantId} and key = 'sales_supervisor'`;
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const file = join(__dirname, '../../../packages/db/drizzle/0076_supervisor_cash_stock.sql');
    const statements = readFileSync(file, 'utf8')
      .split('--> statement-breakpoint')
      .map((p) => p.replace(/^(--[^\n]*\n)+/gm, '').trim())
      .filter(Boolean);
    expect(statements).toHaveLength(1);
    for (let i = 0; i < 2; i++) await ownerDb().unsafe(statements[0]!);
    const after = await ownerDb()<{ permissions: string[] }[]>`
      select permissions from roles where tenant_id = ${s.tenantId} and key = 'sales_supervisor'`;
    expect([...after[0]!.permissions].sort()).toEqual([...before[0]!.permissions].sort());
    // Another store's owner role is not touched
    const [owner] = await ownerDb()<{ n: number }[]>`
      select count(*)::int as n from roles where key = 'owner' and 'cash.move' = any(permissions)`;
    expect(owner!.n).toBe(1);
  });

  it('lets him approve the settlement: the van count and the unloading transfer both go through', async () => {
    const owner = bearer(s.accessToken);
    const product = (
      await app.inject({
        method: 'POST',
        url: '/v1/products',
        headers: owner,
        payload: { nameAr: 'قميص', variants: [{ price: { currency: 'SYP', priceMinor: 100_000 } }] },
      })
    ).json<ProductDetail>();
    const variantId = product.variants[0]!.id;
    const supplier = (
      await app.inject({ method: 'POST', url: '/v1/suppliers', headers: owner, payload: { name: 'معمل' } })
    ).json<SupplierRow>();
    expect(
      (
        await app.inject({
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
        })
      ).statusCode,
    ).toBe(201);
    const v = await van('1');
    expect(
      (
        await call(s.accessToken, 'POST', '/v1/transfers', {
          fromBranchId: s.branchId,
          toBranchId: v.id,
          date: '2026-10-29',
          lines: [{ variantId, qty: 10_000 }],
        })
      ).statusCode,
    ).toBe(201);
    const { rep } = await repOn(v, '482913');
    const device = await repPhone(s.tenantId, v.id, '002');
    const counted = await app.inject({
      method: 'POST',
      url: '/v1/device/rep/van-count',
      headers: { authorization: device.authorization },
      payload: { businessDate: DATE, lines: [{ variantId, counted: 7000 }] },
    });
    expect(counted.statusCode, counted.body).toBe(200);

    const supervisor = await staffUser(app, s, 'sales_supervisor', phone());
    const made = await ok<RepSettlementDetail>(
      supervisor.accessToken,
      'POST',
      '/v1/rep-settlements',
      { repId: rep.id, businessDate: DATE, countedCash: { SYP: 0 } },
      201,
    );
    const approved = await ok<RepSettlementDetail>(
      supervisor.accessToken,
      'POST',
      `/v1/rep-settlements/${made.id}/approve`,
      { version: made.version },
    );
    expect(approved.status).toBe('approved');
    const stock = async (branchId: string) =>
      Number(
        (
          await ownerDb()<{ qty: string }[]>`
            select qty::text from stock_levels where branch_id = ${branchId} and variant_id = ${variantId}`
        )[0]?.qty ?? 0,
      );
    // He counted 7 in the van, and all 7 went back to the store: the van is empty, the store holds 7
    expect(await stock(v.id)).toBe(0);
    expect(await stock(s.branchId)).toBe(7000);
  });
});

/** Documents as a rep phone makes them, numbered in the van's branch */
function documents(device: TestDevice, branchCode: string) {
  let seq = 0;
  const counters = new Map<string, number>();
  const newId = createUuidV7();
  return (type: DocType, payload: unknown): SyncDocument => {
    seq += 1;
    const series = seriesOf(type);
    const n = series ? (counters.get(series) ?? 0) + 1 : 0;
    if (series) counters.set(series, n);
    const body = {
      id: newId(),
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

describe('D5: the rep’s float is a pay-in from the safe over a shift opened at 0', () => {
  it('takes X out of the safe and puts it in the drawer, and the shift and the settlement expect it', async () => {
    const v = await van('1');
    const { userId, rep } = await repOn(v, '482913');
    const manager = await withPin('manager', '285713');
    const device = await repPhone(s.tenantId, v.id, '002');
    const [code] = await ownerDb()<{ code: string }[]>`select code from branches where id = ${v.id}`;
    const doc = documents(device, code!.code);
    const FLOAT = 500_000;

    // The safe holds money to begin with: a till shift of the store drops 2,000,000 into it
    const till = await createDevice(s.tenantId);
    const tillDoc = documents(
      till,
      (await ownerDb()<{ code: string }[]>`select code from branches where id = ${s.branchId}`)[0]!.code,
    );
    const tillOpen = tillDoc(
      'shift_open',
      shiftOpen(s.userId, [{ currency: 'SYP', amountMinor: 2_000_000 }]),
    );
    const drop = tillDoc('cash_movement', movement(s.userId, tillOpen.id, 'safe_drop', 2_000_000));
    const dropped = await push(app, till, [tillOpen, drop]);
    expect(dropped.results.map((r) => r.status)).toEqual(['accepted', 'accepted']);
    await settled();
    const before = await balances(s.tenantId);

    // The day: opens at 0, the float comes in as the till's pay-in with the manager's code
    const open = doc('shift_open', shiftOpen(userId, [{ currency: 'SYP', amountMinor: 0 }]));
    const payIn = doc(
      'cash_movement',
      movement(userId, open.id, 'pay_in', FLOAT, {
        reason: 'عهدة بداية اليوم',
        approval: { userId: manager.userId, method: 'pin', at: `${DATE}T08:58:00.000Z`, offline: false },
      }),
    );
    const close = doc(
      'shift_close',
      shiftClose(userId, open.id, [{ currency: 'SYP', opening: 0, payIn: FLOAT, counted: FLOAT }]),
    );
    const pushed = await push(app, device, [open, payIn, close]);
    expect(
      pushed.results.map((r) => r.status),
      JSON.stringify(pushed.results),
    ).toEqual(['accepted', 'accepted', 'accepted']);
    await settled();

    // The ledger: safe (1120, the SYP safe 112001) down by X, drawer (1110, 111001) up by X, and nothing else moved
    const after = await balances(s.tenantId);
    const delta = (code: string) => (after.get(code)?.base ?? 0) - (before.get(code)?.base ?? 0);
    expect(delta('112001')).toBe(-FLOAT);
    expect(delta('111001')).toBe(FLOAT);
    expect(delta('6200')).toBe(0);
    const total = [...after.values()].reduce((sum, b) => sum + b.base, 0);
    expect(total).toBe(0);
    const [entry] = await ownerDb()<{ n: number }[]>`
      select count(*)::int as n from journal_entries
      where tenant_id = ${s.tenantId} and source_type = 'cash_movement' and source_id = ${payIn.id}`;
    expect(entry!.n).toBe(1);

    // The shift expected X (counted X: no difference), and so does the settlement's «should hand over»
    const [shift] = await ownerDb()<
      {
        opening: { amountMinor: number }[];
        closing: { cash: { expectedMinor: number; differenceMinor: number }[] };
      }[]
    >`
      select opening, closing from shifts where id = ${open.id}`;
    expect(shift!.opening.map((o) => o.amountMinor)).toEqual([0]);
    expect(shift!.closing.cash[0]).toMatchObject({ expectedMinor: FLOAT, differenceMinor: 0 });
    const preview = await ok<SettlementPreview>(
      s.accessToken,
      'GET',
      `/v1/rep-settlements/preview?repId=${rep.id}&date=${DATE}`,
    );
    expect(preview.cash[0]).toMatchObject({
      currency: 'SYP',
      openingMinor: 0,
      payInMinor: FLOAT,
      expectedMinor: FLOAT,
    });
  });
});
