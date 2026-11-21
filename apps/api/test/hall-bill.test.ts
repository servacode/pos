import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  CancellationsResponse,
  HallCommandResponse,
  HallOrder,
  HallResponse,
  KitchenResponse,
  ProductDetail,
} from '@serva/core';
import { hashSecret } from '../src/auth/passwords';
import { ManualClock } from '../src/clock';
import { deviceFields, createDevice, firstBranch, type TestDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

/**
 * The hall's table work on the server (03 › المطاعم): moving and merging tables, splitting the bill
 * by items or equally, cancelling after the kitchen from the till, and the hall devices limit.
 */

let app: FastifyInstance;
let clock: ManualClock;
let s: TestStore;
beforeAll(async () => {
  clock = new ManualClock();
  app = await makeApp({}, { clock });
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});

const MANAGER_PIN = '285713';

interface Item {
  productId: string;
  variantId: string;
}
let menu: { coffee: Item; kebab: Item };
let till: TestDevice;
let waiterDevice: TestDevice;
let kitchen: TestDevice;
let waiterId: string;

async function product(name: string, categoryId: string, priceMinor: number): Promise<Item> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: bearer(s.accessToken),
    payload: {
      nameAr: name,
      type: 'service',
      categoryId,
      variants: [{ price: { currency: 'SYP', priceMinor } }],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const p = res.json<ProductDetail>();
  return { productId: p.id, variantId: p.variants[0]!.id };
}

async function category(name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/categories',
    headers: bearer(s.accessToken),
    payload: { name },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>().id;
}

beforeEach(async () => {
  await resetDatabase();
  clock.set('2026-11-12T10:00:00.000Z');
  s = await testStore(app);
  await ownerDb()`update tenant_settings set service = ${ownerDb().json({
    tables: ['1', '2', 'VIP'],
    orderNumbers: true,
    kitchenTickets: true,
  })} where tenant_id = ${s.tenantId}`;
  const drinks = await category('مشروبات');
  const grills = await category('مشاوي');
  menu = { coffee: await product('قهوة', drinks, 15_000), kebab: await product('كباب', grills, 90_000) };
  till = await createDevice(s.tenantId);
  waiterDevice = await createDevice(s.tenantId);
  kitchen = await createDevice(s.tenantId);
  await ownerDb()`update devices set kind = 'waiter' where id = ${waiterDevice.deviceId}`;
  await ownerDb()`update devices set kind = 'kitchen_screen' where id = ${kitchen.deviceId}`;
  const pin = await app.inject({
    method: 'PUT',
    url: '/v1/me/pin',
    headers: bearer(s.accessToken),
    payload: { pin: MANAGER_PIN, password: 'secret-pass-1' },
  });
  expect(pin.statusCode, pin.body).toBe(204);
  const waiter = await staffUser(app, s, 'waiter', '0922222222', { fullName: 'نادل أول' });
  waiterId = waiter.userId;
  await ownerDb()`update users set pin_hash = ${await hashSecret('4829')}, pin_length = 4 where id = ${waiterId}`;
});

const hall = (device: TestDevice, payload: object) =>
  app.inject({
    method: 'POST',
    url: '/v1/device/hall',
    headers: { authorization: device.authorization },
    payload,
  });
const get = <T>(device: TestDevice, url: string) =>
  app
    .inject({ method: 'GET', url, headers: { authorization: device.authorization } })
    .then((r) => ({ status: r.statusCode, body: r.json<T>() }));

async function openTable(table = '1'): Promise<HallOrder> {
  const res = await hall(waiterDevice, { type: 'open', userId: waiterId, table, guests: 3 });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<HallCommandResponse>().order!;
}

const lineOf = (item: Item, name: string) => ({ ...item, name, qty: 1 });

async function addAndSend(
  order: HallOrder,
  lines = [lineOf(menu.coffee, 'قهوة'), lineOf(menu.kebab, 'كباب')],
): Promise<HallOrder> {
  const added = await hall(waiterDevice, { type: 'add', userId: waiterId, orderId: order.id, lines });
  expect(added.statusCode, added.body).toBe(200);
  const sent = await hall(waiterDevice, { type: 'send', userId: waiterId, orderId: order.id });
  expect(sent.statusCode, sent.body).toBe(200);
  return sent.json<HallCommandResponse>().order!;
}

const run = async (device: TestDevice, payload: object, userId = s.userId) => {
  const res = await hall(device, { userId, ...payload });
  return { status: res.statusCode, body: res.json() };
};

describe('moving and merging tables', () => {
  it('moves an order to a free table with its lines, states and kitchen slips', async () => {
    const order = await addAndSend(await openTable('1'));
    const moved = await run(waiterDevice, { type: 'move', orderId: order.id, table: 'VIP' }, waiterId);
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.order).toMatchObject({ id: order.id, table: 'VIP' });
    expect(moved.body.order.lines.map((l: { status: string }) => l.status)).toEqual(['sent', 'sent']);
    const tickets = await get<KitchenResponse>(kitchen, '/v1/device/kitchen');
    expect(tickets.body.tickets.map((t) => t.table)).toEqual(['VIP', 'VIP']);
    // The old table is free again
    expect((await openTable('1')).id).not.toBe(order.id);
    const events = await ownerDb()`select type, data from open_order_events where order_id = ${order.id}`;
    expect(events.find((e) => e.type === 'moved')!.data).toEqual({ from: '1', to: 'VIP' });
  });

  it('refuses a taken table, an unknown one, and the kitchen screen', async () => {
    const a = await openTable('1');
    await openTable('2');
    expect((await run(waiterDevice, { type: 'move', orderId: a.id, table: '2' }, waiterId)).status).toBe(409);
    expect((await run(waiterDevice, { type: 'move', orderId: a.id, table: '99' }, waiterId)).status).toBe(
      400,
    );
    expect((await run(waiterDevice, { type: 'move', orderId: a.id, table: '1' }, waiterId)).status).toBe(200);
    expect((await run(kitchen, { type: 'move', orderId: a.id, table: 'VIP' })).status).toBe(403);
  });

  it('merges two orders into one: lines, tickets and guests join, the other table is free', async () => {
    const a = await addAndSend(await openTable('1'));
    const b = await openTable('2');
    await addAndSend(b, [lineOf(menu.coffee, 'قهوة')]);
    const merged = await run(till, { type: 'merge', orderId: a.id, fromOrderId: b.id });
    expect(merged.status, JSON.stringify(merged.body)).toBe(200);
    expect(merged.body.order.lines).toHaveLength(3);
    expect(merged.body.order.guests).toBe(6);
    expect(merged.body.order.status).toBe('open');
    const tickets = await get<KitchenResponse>(kitchen, '/v1/device/kitchen');
    expect(new Set(tickets.body.tickets.map((t) => t.table))).toEqual(new Set(['1']));
    const state = await get<HallResponse>(till, '/v1/device/hall');
    expect(state.body.orders.map((o) => o.table)).toEqual(['1']);
    const [gone] = await ownerDb()`select status, closed_reason from open_orders where id = ${b.id}`;
    expect(gone).toMatchObject({ status: 'closed', closed_reason: 'merged' });
    const types = await ownerDb()`select type from open_order_events where order_id in (${a.id}, ${b.id})`;
    expect(types.map((e) => e.type)).toEqual(expect.arrayContaining(['merged', 'merged_into']));
    expect((await run(till, { type: 'merge', orderId: a.id, fromOrderId: a.id })).status).toBe(409);
    expect((await run(till, { type: 'merge', orderId: a.id, fromOrderId: b.id })).status).toBe(409);
  });
});

describe('splitting the bill', () => {
  const part = (orderId: string, payload: object, device = till) =>
    hall(device, { type: 'part', userId: s.userId, orderId, ...payload });
  const cancelAs = (orderId: string, lineId: string) =>
    hall(till, {
      type: 'cancel',
      userId: s.userId,
      orderId,
      lineId,
      reason: 'غيّر الزبون رأيه',
      approverId: s.userId,
      approverPin: MANAGER_PIN,
    });

  it('charges by items: the order closes after the last part, and a replayed part counts once', async () => {
    const order = await addAndSend(await openTable('1'));
    const [coffee, kebab] = order.lines;
    const first = await part(order.id, { lineIds: [coffee!.id], ref: 'INV-1' });
    expect(first.statusCode, first.body).toBe(200);
    const live = first.json<HallCommandResponse>().order!;
    expect(live.paidLineIds).toEqual([coffee!.id]);
    expect(live.status).toBe('open');
    const again = await part(order.id, { lineIds: [coffee!.id], ref: 'INV-1' });
    expect(again.json<HallCommandResponse>().order!.paidLineIds).toEqual([coffee!.id]);
    expect((await part(order.id, { lineIds: [coffee!.id], ref: 'INV-X' })).statusCode).toBe(409);
    expect((await cancelAs(order.id, coffee!.id)).statusCode).toBe(409);
    const last = await part(order.id, { lineIds: [kebab!.id], ref: 'INV-2' });
    expect(last.json<HallCommandResponse>().order).toBeNull();
    const [row] =
      await ownerDb()`select status, closed_reason, closed_ref from open_orders where id = ${order.id}`;
    expect(row).toMatchObject({ status: 'closed', closed_reason: 'paid', closed_ref: 'INV-2' });
    expect((await get<HallResponse>(till, '/v1/device/hall')).body.orders).toEqual([]);
  });

  it('charges equally: closes when every part is paid, no mixing and no new lines', async () => {
    const order = await addAndSend(await openTable('1'));
    const one = await part(order.id, { equal: { parts: 3 }, ref: 'E-1' });
    expect(one.json<HallCommandResponse>().order!.equal).toEqual({ parts: 3, paid: 1 });
    expect((await part(order.id, { equal: { parts: 4 }, ref: 'E-x' })).statusCode).toBe(409);
    expect((await part(order.id, { lineIds: [order.lines[0]!.id], ref: 'E-y' })).statusCode).toBe(409);
    const add = await hall(waiterDevice, {
      type: 'add',
      userId: waiterId,
      orderId: order.id,
      lines: [lineOf(menu.coffee, 'قهوة')],
    });
    expect(add.statusCode).toBe(409);
    await part(order.id, { equal: { parts: 3 }, ref: 'E-2' });
    const done = await part(order.id, { equal: { parts: 3 }, ref: 'E-3' });
    expect(done.json<HallCommandResponse>().order).toBeNull();
    expect((await part(order.id, { equal: { parts: 3 }, ref: 'E-4' })).statusCode).toBe(409);
  });

  it('needs exactly one of items or equal, never lets the waiter charge, refuses a merge after a part', async () => {
    const order = await addAndSend(await openTable('1'));
    expect((await part(order.id, { ref: 'R' })).statusCode).toBe(400);
    const both = await part(order.id, { ref: 'R', lineIds: [order.lines[0]!.id], equal: { parts: 2 } });
    expect(both.statusCode).toBe(400);
    const byWaiter = await part(
      order.id,
      { ref: 'R', lineIds: [order.lines[0]!.id], userId: waiterId },
      waiterDevice,
    );
    expect(byWaiter.statusCode).toBe(403);
    await part(order.id, { lineIds: [order.lines[0]!.id], ref: 'R-1' });
    const other = await openTable('2');
    const merge = await run(till, { type: 'merge', orderId: other.id, fromOrderId: order.id });
    expect(merge.status).toBe(409);
  });

  it('closes the order when the only unpaid lines are cancelled', async () => {
    const order = await addAndSend(await openTable('1'));
    await part(order.id, { lineIds: [order.lines[0]!.id], ref: 'P-1' });
    const cancelled = await cancelAs(order.id, order.lines[1]!.id);
    expect(cancelled.json<HallCommandResponse>().order).toBeNull();
  });
});

describe('cancelling from the till', () => {
  const tillCancel = (orderId: string, lineId: string, extra: object) =>
    hall(till, {
      type: 'cancel',
      userId: s.userId,
      orderId,
      lineId,
      reason: 'غيّر الزبون رأيه',
      approverId: s.userId,
      ...extra,
    });

  it('shows the kitchen the cancellation when the till sends the manager’s code', async () => {
    const order = await addAndSend(await openTable('1'));
    const res = await tillCancel(order.id, order.lines[0]!.id, { approverPin: MANAGER_PIN });
    expect(res.statusCode, res.body).toBe(200);
    const board = await get<KitchenResponse>(kitchen, '/v1/device/kitchen');
    const cancelled = board.body.tickets.flatMap((t) => t.lines).filter((l) => l.status === 'cancelled');
    expect(cancelled.map((l) => l.cancelReason)).toEqual(['غيّر الزبون رأيه']);
  });

  it('takes a cancellation approved on the till while offline, only from a till and a real approver', async () => {
    const order = await addAndSend(await openTable('1'));
    const at = '2026-11-12T09:58:00.000Z';
    expect((await tillCancel(order.id, order.lines[0]!.id, {})).statusCode).toBe(400);
    const byWaiter = await hall(waiterDevice, {
      type: 'cancel',
      userId: waiterId,
      orderId: order.id,
      lineId: order.lines[0]!.id,
      reason: 'غيّر الزبون رأيه',
      approverId: s.userId,
      offlineApproval: { at },
    });
    expect(byWaiter.statusCode).toBe(400);
    const notManager = await tillCancel(order.id, order.lines[0]!.id, {
      approverId: waiterId,
      offlineApproval: { at },
    });
    expect(notManager.statusCode).toBe(403);
    const ok = await tillCancel(order.id, order.lines[0]!.id, { offlineApproval: { at } });
    expect(ok.statusCode, ok.body).toBe(200);
    const [ev] =
      await ownerDb()`select data from open_order_events where order_id = ${order.id} and type = 'cancelled'`;
    expect(ev!.data).toMatchObject({ approvalOffline: true, approvalAt: at, approvedBy: s.userId });
    const report = await app.inject({
      method: 'GET',
      url: '/v1/hall/cancellations',
      headers: bearer(s.accessToken),
    });
    expect(report.json<CancellationsResponse>().items).toHaveLength(1);
  });
});

describe('the hall devices limit', () => {
  it('counts waiter, kitchen and call devices apart from tills, null meaning unlimited', async () => {
    const setLimits = (limits: object) =>
      ownerDb()`
        update plans set limits = ${ownerDb().json(limits as never)}
        where id = (select plan_id from subscriptions where tenant_id = ${s.tenantId})`;
    await setLimits({ registers: 1, hallDevices: 3 });
    const branch = await firstBranch(s.tenantId);
    const activate = (kind: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/devices/activate',
        headers: bearer(s.accessToken),
        payload: { method: 'owner', branchId: branch, ...deviceFields(`جهاز ${kind}`), kind },
      });
    // The store already has a waiter device and a kitchen screen: 2 of 3 used
    expect((await activate('call_screen')).statusCode).toBe(201);
    const over = await activate('waiter');
    expect(over.statusCode).toBe(403);
    expect(over.json().error.code).toBe('plan_limit_reached');
    expect(over.json().error.message).toContain('للنُدُل والمطبخ');
    // A till is limited by its own number (1 of 1), not by the hall one
    expect((await activate('cashier')).statusCode).toBe(403);
    await setLimits({ registers: 1, hallDevices: null });
    expect((await activate('waiter')).statusCode).toBe(201);
    await setLimits({ registers: 1 });
    expect((await activate('kitchen_screen')).statusCode).toBe(201);
    // The plan is shared by every test of the run: leave it as it was found
    await setLimits({});
  });
});

describe('the pairing link of a hall device', () => {
  it('carries the kind before the # so a kitchen screen or a waiter opens its own page', async () => {
    const branchId = await firstBranch(s.tenantId);
    const make = async (payload: object) => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/devices/pairing-codes',
        headers: bearer(s.accessToken),
        payload: { branchId, ...payload },
      });
      expect(res.statusCode, res.body).toBe(201);
      return res.json<{ qrPayload: string; qrToken: string }>();
    };
    const kitchenLink = await make({ kind: 'kitchen_screen' });
    expect(kitchenLink.qrPayload).toMatch(/\/link\?kind=kitchen_screen#spq_/);
    expect((await make({ kind: 'waiter' })).qrPayload).toContain('/link?kind=waiter#');
    // A till's link is as it always was
    expect((await make({ kind: 'cashier' })).qrPayload).toMatch(/\/link#spq_/);
    expect((await make({})).qrPayload).toMatch(/\/link#spq_/);
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/devices/pairing-codes',
      headers: bearer(s.accessToken),
      payload: { branchId, kind: 'price_checker' },
    });
    expect(bad.statusCode).toBe(400);
  });
});
