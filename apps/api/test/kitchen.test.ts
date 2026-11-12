import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  CancellationsResponse,
  HallCommandResponse,
  HallMenuResponse,
  HallOrder,
  HallResponse,
  KitchenResponse,
  ProductDetail,
} from '@serva/core';
import { randomBytes } from 'node:crypto';
import { hashDeviceToken } from '../src/auth/device-guard';
import { hashSecret } from '../src/auth/passwords';
import { ManualClock } from '../src/clock';
import { deviceFields, createDevice, firstBranch, type TestDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

/**
 * The hall and the kitchen on the server (03 › المطاعم): shared open orders, the kitchen screen's
 * tickets and lines, the waiter's limits, and cancellations after the kitchen.
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

interface Menu {
  coffee: { productId: string; variantId: string };
  kebab: { productId: string; variantId: string };
}

let till: TestDevice;
let waiterDevice: TestDevice;
let kitchen: TestDevice;
let waiterId: string;
let menu: Menu;

async function product(name: string, categoryId: string | null, priceMinor: number) {
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
  // The owner is the manager: a 6-digit code approves cancellations
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
const kitchenPost = (device: TestDevice, payload: object) =>
  app.inject({
    method: 'POST',
    url: '/v1/device/kitchen',
    headers: { authorization: device.authorization },
    payload,
  });
const get = <T>(device: TestDevice, url: string) =>
  app
    .inject({ method: 'GET', url, headers: { authorization: device.authorization } })
    .then((r) => ({ status: r.statusCode, body: r.json<T>() }));

async function openTable(table = '1', device = waiterDevice, userId = waiterId): Promise<HallOrder> {
  const res = await hall(device, { type: 'open', userId, table, guests: 3 });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<HallCommandResponse>().order!;
}

const lineOf = (item: { productId: string; variantId: string }, name: string, extra: object = {}) => ({
  ...item,
  name,
  qty: 1,
  ...extra,
});

async function addAndSend(
  order: HallOrder,
  lines = [lineOf(menu.coffee, 'قهوة'), lineOf(menu.kebab, 'كباب')],
) {
  const added = await hall(waiterDevice, { type: 'add', userId: waiterId, orderId: order.id, lines });
  expect(added.statusCode, added.body).toBe(200);
  const sent = await hall(waiterDevice, { type: 'send', userId: waiterId, orderId: order.id });
  expect(sent.statusCode, sent.body).toBe(200);
  return sent.json<HallCommandResponse>().order!;
}

describe('the waiter’s order', () => {
  it('opens a table once, takes lines with choices, notes and seats, and removes a line before the send', async () => {
    const order = await openTable('1');
    expect(order).toMatchObject({
      table: '1',
      guests: 3,
      status: 'open',
      openedByName: 'نادل أول',
      lines: [],
    });
    // Opening again returns the same order, not a second one
    expect((await openTable('1', till, s.userId)).id).toBe(order.id);

    const added = await hall(waiterDevice, {
      type: 'add',
      userId: waiterId,
      orderId: order.id,
      lines: [
        lineOf(menu.coffee, 'قهوة · كبير', {
          choices: [{ group: 'الحجم', name: 'كبير', priceMinor: 5_000 }],
          note: 'بدون سكر',
          seat: 2,
          qty: 2,
        }),
        lineOf(menu.kebab, 'كباب'),
      ],
    });
    expect(added.statusCode, added.body).toBe(200);
    const lines = added.json<HallCommandResponse>().order!.lines;
    expect(lines.map((l) => [l.name, l.qty, l.status, l.section, l.seat, l.note])).toEqual([
      ['قهوة · كبير', 2, 'new', 'مشروبات', 2, 'بدون سكر'],
      ['كباب', 1, 'new', 'مشاوي', null, null],
    ]);
    expect(lines[0]!.choices).toEqual([{ group: 'الحجم', name: 'كبير', priceMinor: 5_000 }]);

    const removed = await hall(waiterDevice, {
      type: 'remove',
      userId: waiterId,
      orderId: order.id,
      lineId: lines[1]!.id,
    });
    expect(removed.json<HallCommandResponse>().order!.lines.map((l) => l.name)).toEqual(['قهوة · كبير']);
    // Removing again is a no-op, not an error
    expect(
      (
        await hall(waiterDevice, {
          type: 'remove',
          userId: waiterId,
          orderId: order.id,
          lineId: lines[1]!.id,
        })
      ).statusCode,
    ).toBe(200);
  });

  it('refuses a table outside the hall, an unknown item and a missing order', async () => {
    const bad = await hall(waiterDevice, { type: 'open', userId: waiterId, table: '99' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields.table).toMatch(/غير موجودة/);
    const order = await openTable('1');
    const unknown = await hall(waiterDevice, {
      type: 'add',
      userId: waiterId,
      orderId: order.id,
      lines: [lineOf({ productId: menu.coffee.productId, variantId: menu.kebab.variantId }, 'قهوة')],
    });
    expect(unknown.statusCode).toBe(400);
    const none = await hall(waiterDevice, {
      type: 'send',
      userId: waiterId,
      orderId: '019c0000-0000-7000-8000-000000000000',
    });
    expect(none.statusCode).toBe(404);
    // Nothing new to send
    expect((await hall(waiterDevice, { type: 'send', userId: waiterId, orderId: order.id })).statusCode).toBe(
      409,
    );
  });

  it('two screens adding to one table keep both sets of lines', async () => {
    const order = await openTable('2');
    const [one, two] = await Promise.all([
      hall(waiterDevice, {
        type: 'add',
        userId: waiterId,
        orderId: order.id,
        lines: [lineOf(menu.coffee, 'قهوة')],
      }),
      hall(till, { type: 'add', userId: s.userId, orderId: order.id, lines: [lineOf(menu.kebab, 'كباب')] }),
    ]);
    expect(one.statusCode, one.body).toBe(200);
    expect(two.statusCode, two.body).toBe(200);
    const state = await get<HallResponse>(till, '/v1/device/hall');
    expect(state.body.orders).toHaveLength(1);
    expect(state.body.orders[0]!.lines.map((l) => l.name).sort()).toEqual(['قهوة', 'كباب']);
    expect(state.body.tables).toEqual(['1', '2', 'VIP']);
    expect(state.body.orders[0]!.version).toBeGreaterThan(order.version);
  });

  it('knows only people who may take orders in this branch', async () => {
    await ownerDb()`update roles set permissions = '{}' where tenant_id = ${s.tenantId} and key = 'waiter'`;
    const denied = await hall(waiterDevice, { type: 'open', userId: waiterId, table: '1' });
    expect(denied.statusCode).toBe(403);
    const ghost = await hall(waiterDevice, {
      type: 'open',
      userId: '019c0000-0000-7000-8000-000000000000',
      table: '1',
    });
    expect(ghost.statusCode).toBe(403);
    // A cashier (sale.create) may use the hall at the till
    expect((await hall(till, { type: 'open', userId: s.userId, table: '1' })).statusCode).toBe(200);
    // Nobody is signed in without a token
    const open = await app.inject({
      method: 'POST',
      url: '/v1/device/hall',
      payload: { type: 'open', userId: waiterId, table: '1' },
    });
    expect(open.statusCode).toBe(401);
  });
});

describe('the kitchen', () => {
  it('sends one ticket per section, then an «إضافة» ticket for later items', async () => {
    const order = await openTable('1');
    const sent = await addAndSend(order);
    expect(sent.lines.map((l) => l.status)).toEqual(['sent', 'sent']);
    let board = (await get<KitchenResponse>(kitchen, '/v1/device/kitchen')).body;
    expect(board.tickets.map((t) => [t.section, t.table, t.kind, t.lines.map((l) => l.name)])).toEqual([
      ['مشروبات', '1', 'new', ['قهوة']],
      ['مشاوي', '1', 'new', ['كباب']],
    ]);
    expect(board.sections).toEqual(expect.arrayContaining(['مشروبات', 'مشاوي']));
    expect(board.tickets[0]!.seq).toBeLessThan(board.tickets[1]!.seq);

    await addAndSend(order, [lineOf(menu.coffee, 'قهوة')]);
    board = (await get<KitchenResponse>(kitchen, '/v1/device/kitchen')).body;
    expect(board.tickets).toHaveLength(3);
    expect(board.tickets[2]).toMatchObject({ section: 'مشروبات', kind: 'add' });
  });

  it('moves a line new → preparing → ready, the waiter serves it, and only a kitchen screen may move lines', async () => {
    const order = await openTable('1');
    const sent = await addAndSend(order, [lineOf(menu.coffee, 'قهوة')]);
    const lineId = sent.lines[0]!.id;

    const denied = await kitchenPost(waiterDevice, {
      type: 'status',
      lineIds: [lineId],
      status: 'preparing',
    });
    expect(denied.statusCode).toBe(403);
    const preparing = await kitchenPost(kitchen, { type: 'status', lineIds: [lineId], status: 'preparing' });
    expect(preparing.statusCode, preparing.body).toBe(200);
    expect(preparing.json<KitchenResponse>().tickets[0]!.lines[0]!.status).toBe('preparing');
    // Same status again changes nothing
    expect(
      (await kitchenPost(kitchen, { type: 'status', lineIds: [lineId], status: 'preparing' })).statusCode,
    ).toBe(200);

    // The waiter's hall shows the order moved on
    const before = (await get<HallResponse>(waiterDevice, '/v1/device/hall')).body.orders[0]!;
    expect(before.lines[0]!.status).toBe('preparing');
    const ready = await kitchenPost(kitchen, { type: 'status', lineIds: [lineId], status: 'ready' });
    expect(ready.json<KitchenResponse>().tickets[0]!.lines[0]).toMatchObject({ status: 'ready' });
    const after = (await get<HallResponse>(waiterDevice, '/v1/device/hall')).body.orders[0]!;
    expect(after.lines[0]!.status).toBe('ready');
    expect(after.lines[0]!.readyAt).toBeTruthy();
    expect(after.version).toBeGreaterThan(before.version);

    // Not ready yet lines cannot be served
    const served = await hall(waiterDevice, {
      type: 'serve',
      userId: waiterId,
      orderId: order.id,
      lineIds: [lineId],
    });
    expect(served.json<HallCommandResponse>().order!.lines[0]!.status).toBe('served');
    expect(
      (await hall(waiterDevice, { type: 'serve', userId: waiterId, orderId: order.id, lineIds: [lineId] }))
        .statusCode,
    ).toBe(409);
    // A served line cannot be pulled back by the kitchen
    expect(
      (await kitchenPost(kitchen, { type: 'status', lineIds: [lineId], status: 'preparing' })).statusCode,
    ).toBe(409);
    expect((await get<KitchenResponse>(kitchen, '/v1/device/kitchen')).body.tickets).toEqual([]);
  });

  it('undoes a step, lets a ready line stay for fifteen minutes, and refuses unknown lines', async () => {
    const order = await openTable('1');
    const lineId = (await addAndSend(order, [lineOf(menu.coffee, 'قهوة')])).lines[0]!.id;
    await kitchenPost(kitchen, { type: 'status', lineIds: [lineId], status: 'ready' });
    await kitchenPost(kitchen, { type: 'status', lineIds: [lineId], status: 'preparing' });
    await kitchenPost(kitchen, { type: 'status', lineIds: [lineId], status: 'sent' });
    const [row] = await ownerDb()<{ status: string; ready_at: Date | null; preparing_at: Date | null }[]>`
      select status, ready_at, preparing_at from open_order_lines where id = ${lineId}`;
    expect(row).toEqual({ status: 'sent', ready_at: null, preparing_at: null });
    await kitchenPost(kitchen, { type: 'status', lineIds: [lineId], status: 'ready' });
    expect((await get<KitchenResponse>(kitchen, '/v1/device/kitchen')).body.tickets).toHaveLength(1);
    clock.set('2026-11-12T10:20:00.000Z');
    await ownerDb()`update open_order_lines set ready_at = '2026-11-12T10:00:00Z' where id = ${lineId}`;
    expect((await get<KitchenResponse>(kitchen, '/v1/device/kitchen')).body.tickets).toEqual([]);
    const unknown = await kitchenPost(kitchen, {
      type: 'status',
      lineIds: ['019c0000-0000-7000-8000-000000000000'],
      status: 'ready',
    });
    expect(unknown.statusCode).toBe(404);
    // A new line cannot jump to «ready» (it was never sent)
    const order2 = await openTable('2');
    const fresh = await hall(waiterDevice, {
      type: 'add',
      userId: waiterId,
      orderId: order2.id,
      lines: [lineOf(menu.coffee, 'قهوة')],
    });
    const newId = fresh.json<HallCommandResponse>().order!.lines[0]!.id;
    expect(
      (await kitchenPost(kitchen, { type: 'status', lineIds: [newId], status: 'ready' })).statusCode,
    ).toBe(409);
  });

  it('keeps the kitchen to its own branch’s lines and the waiter off the kitchen screen', async () => {
    const order = await openTable('1');
    const lineId = (await addAndSend(order, [lineOf(menu.coffee, 'قهوة')])).lines[0]!.id;
    const other = await ownerDb()<{ id: string }[]>`
      insert into branches (tenant_id, code, name) values (${s.tenantId}, '002', 'فرع ثان') returning id`;
    const token = `sdt_${randomBytes(32).toString('base64url')}`;
    await ownerDb()`
      insert into devices (tenant_id, branch_id, code, name, kind, status, token_hash)
      values (${s.tenantId}, ${other[0]!.id}, '001', 'مطبخ الفرع الثاني', 'kitchen_screen', 'active', ${hashDeviceToken(token)})`;
    const far = { authorization: `Device ${token}` } as TestDevice;
    expect((await get<KitchenResponse>(far, '/v1/device/kitchen')).body.tickets).toEqual([]);
    expect((await kitchenPost(far, { type: 'status', lineIds: [lineId], status: 'ready' })).statusCode).toBe(
      404,
    );
    expect((await get<HallResponse>(far, '/v1/device/hall')).body.orders).toEqual([]);
    // The kitchen screen does not edit orders
    expect((await hall(kitchen, { type: 'open', userId: s.userId, table: '2' })).statusCode).toBe(403);
  });
});

describe('the bill and the payment', () => {
  it('asks for the bill, goes back to open with new items, and only a till closes it as paid', async () => {
    const order = await openTable('1');
    expect((await hall(waiterDevice, { type: 'bill', userId: waiterId, orderId: order.id })).statusCode).toBe(
      409,
    );
    await addAndSend(order, [lineOf(menu.coffee, 'قهوة')]);
    const billed = await hall(waiterDevice, { type: 'bill', userId: waiterId, orderId: order.id });
    expect(billed.json<HallCommandResponse>().order).toMatchObject({ status: 'bill_requested' });
    expect(billed.json<HallCommandResponse>().order!.billRequestedAt).toBeTruthy();
    // Asking again is harmless
    expect((await hall(waiterDevice, { type: 'bill', userId: waiterId, orderId: order.id })).statusCode).toBe(
      200,
    );

    const more = await hall(waiterDevice, {
      type: 'add',
      userId: waiterId,
      orderId: order.id,
      lines: [lineOf(menu.coffee, 'قهوة')],
    });
    expect(more.json<HallCommandResponse>().order).toMatchObject({ status: 'open', billRequestedAt: null });

    const refused = await hall(waiterDevice, {
      type: 'close',
      userId: waiterId,
      orderId: order.id,
      reason: 'paid',
    });
    expect(refused.statusCode).toBe(403);
    const paid = await hall(till, {
      type: 'close',
      userId: s.userId,
      orderId: order.id,
      reason: 'paid',
      ref: 'INV-001-002-0000001',
    });
    expect(paid.json<HallCommandResponse>().order).toBeNull();
    const [row] = await ownerDb()<{ status: string; closed_reason: string; closed_ref: string }[]>`
      select status, closed_reason, closed_ref from open_orders where id = ${order.id}`;
    expect(row).toEqual({ status: 'closed', closed_reason: 'paid', closed_ref: 'INV-001-002-0000001' });
    expect((await get<HallResponse>(till, '/v1/device/hall')).body.orders).toEqual([]);
    // A closed order accepts no more changes, and the table is free again
    expect(
      (await hall(till, { type: 'close', userId: s.userId, orderId: order.id, reason: 'paid' })).statusCode,
    ).toBe(409);
    expect(
      (
        await hall(waiterDevice, {
          type: 'add',
          userId: waiterId,
          orderId: order.id,
          lines: [lineOf(menu.coffee, 'قهوة')],
        })
      ).statusCode,
    ).toBe(409);
    expect((await openTable('1')).id).not.toBe(order.id);
  });

  it('drops an order that never reached the kitchen, but not one that did', async () => {
    const order = await openTable('1');
    await hall(waiterDevice, {
      type: 'add',
      userId: waiterId,
      orderId: order.id,
      lines: [lineOf(menu.coffee, 'قهوة')],
    });
    const dropped = await hall(waiterDevice, {
      type: 'close',
      userId: waiterId,
      orderId: order.id,
      reason: 'empty',
    });
    expect(dropped.json<HallCommandResponse>().order).toBeNull();
    const next = await openTable('2');
    await addAndSend(next, [lineOf(menu.coffee, 'قهوة')]);
    const refused = await hall(waiterDevice, {
      type: 'close',
      userId: waiterId,
      orderId: next.id,
      reason: 'empty',
    });
    expect(refused.statusCode).toBe(409);
  });
});

describe('cancelling after the kitchen', () => {
  async function sentLine() {
    const order = await openTable('1');
    const sent = await addAndSend(order);
    return { order, coffee: sent.lines[0]!, kebab: sent.lines[1]! };
  }
  const cancel = (orderId: string, lineId: string, extra: object = {}) =>
    hall(waiterDevice, {
      type: 'cancel',
      userId: waiterId,
      orderId,
      lineId,
      reason: 'غيّر الزبون رأيه',
      approverId: s.userId,
      approverPin: MANAGER_PIN,
      ...extra,
    });

  it('needs the manager’s code, a reason, and a code that holds the permission', async () => {
    const { order, coffee } = await sentLine();
    const wrong = await cancel(order.id, coffee.id, { approverPin: '111112' });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('pin_invalid');
    const waiterAsApprover = await cancel(order.id, coffee.id, { approverId: waiterId, approverPin: '4829' });
    expect(waiterAsApprover.statusCode).toBe(403);
    const noReason = await cancel(order.id, coffee.id, { reason: '' });
    expect(noReason.statusCode).toBe(400);
    const [row] = await ownerDb()<
      { status: string }[]
    >`select status from open_order_lines where id = ${coffee.id}`;
    expect(row!.status).toBe('sent');
    // A line not sent yet is removed, not cancelled
    const fresh = await hall(waiterDevice, {
      type: 'add',
      userId: waiterId,
      orderId: order.id,
      lines: [lineOf(menu.coffee, 'قهوة')],
    });
    const newLine = fresh.json<HallCommandResponse>().order!.lines.find((l) => l.status === 'new')!;
    expect((await cancel(order.id, newLine.id)).statusCode).toBe(409);
    expect(
      (await hall(waiterDevice, { type: 'remove', userId: waiterId, orderId: order.id, lineId: coffee.id }))
        .statusCode,
    ).toBe(409);
  });

  it('cancels with a reason, tells the kitchen, and lists it for the owner with both names', async () => {
    const { order, coffee, kebab } = await sentLine();
    await kitchenPost(kitchen, { type: 'status', lineIds: [kebab.id], status: 'preparing' });
    const early = await cancel(order.id, coffee.id);
    expect(early.statusCode, early.body).toBe(200);
    expect(early.json<HallCommandResponse>().order!.lines[0]).toMatchObject({
      status: 'cancelled',
      cancelReason: 'غيّر الزبون رأيه',
      cancelledAfterSend: true,
    });
    const late = await cancel(order.id, kebab.id, { reason: 'تأخر الطلب' });
    expect(late.statusCode, late.body).toBe(200);
    // Cancelling twice, or a served line, is refused
    expect((await cancel(order.id, kebab.id)).statusCode).toBe(409);

    // The kitchen still sees both until it acknowledges
    let board = (await get<KitchenResponse>(kitchen, '/v1/device/kitchen')).body;
    expect(board.tickets.flatMap((t) => t.lines.map((l) => [l.name, l.status, l.cancelReason]))).toEqual([
      ['قهوة', 'cancelled', 'غيّر الزبون رأيه'],
      ['كباب', 'cancelled', 'تأخر الطلب'],
    ]);
    const acked = await kitchenPost(kitchen, { type: 'ack', lineIds: [coffee.id, kebab.id] });
    expect(acked.json<KitchenResponse>().tickets).toEqual([]);
    board = (await get<KitchenResponse>(kitchen, '/v1/device/kitchen')).body;
    expect(board.tickets).toEqual([]);

    const report = await app.inject({
      method: 'GET',
      url: '/v1/hall/cancellations',
      headers: bearer(s.accessToken),
    });
    expect(report.statusCode, report.body).toBe(200);
    const body = report.json<CancellationsResponse>();
    expect(body.items.map((i) => [i.item, i.reason, i.stage, i.waiterName, i.approverName, i.table])).toEqual(
      expect.arrayContaining([
        ['قهوة', 'غيّر الزبون رأيه', 'before_prep', 'نادل أول', expect.any(String), '1'],
        ['كباب', 'تأخر الطلب', 'after_prep', 'نادل أول', expect.any(String), '1'],
      ]),
    );
    expect(body.items).toHaveLength(2);
    const ranged = await app.inject({
      method: 'GET',
      url: '/v1/hall/cancellations?from=2026-11-13&to=2026-11-14',
      headers: bearer(s.accessToken),
    });
    expect(ranged.json<CancellationsResponse>().items).toEqual([]);
  });

  it('shows the report only to people who may see reports', async () => {
    const waiter = await staffUser(app, s, 'waiter', '0933333333');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hall/cancellations',
      headers: bearer(waiter.accessToken),
    });
    expect(res.statusCode).toBe(403);
    const none = await app.inject({ method: 'GET', url: '/v1/hall/cancellations' });
    expect(none.statusCode).toBe(401);
  });
});

describe('the menu and the plan', () => {
  it('lists the menu with sections and prices, the people who can sign in and the approvers', async () => {
    const res = await get<HallMenuResponse>(waiterDevice, '/v1/device/menu');
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('SYP');
    expect(res.body.tables).toEqual(['1', '2', 'VIP']);
    expect(res.body.items.map((i) => [i.name, i.category, i.section, i.priceMinor])).toEqual([
      ['قهوة', 'مشروبات', 'مشروبات', 15_000],
      ['كباب', 'مشاوي', 'مشاوي', 90_000],
    ]);
    expect(res.body.staff).toHaveLength(2);
    expect(res.body.staff).toEqual(
      expect.arrayContaining([
        { id: waiterId, fullName: 'نادل أول', pinLength: 4 },
        { id: s.userId, fullName: expect.any(String), pinLength: 6 },
      ]),
    );
    expect(res.body.approvers).toEqual([{ id: s.userId, fullName: expect.any(String) }]);
  });

  it('does not count waiter, kitchen and call screens as cashier devices', async () => {
    await ownerDb()`
      update plans set limits = ${ownerDb().json({ registers: 3 })}
      where id = (select plan_id from subscriptions where tenant_id = ${s.tenantId})`;
    // The store already has a till, a waiter device and a kitchen screen: 1 counted of 3
    const branch = await firstBranch(s.tenantId);
    for (const kind of ['cashier', 'cashier', 'waiter', 'kitchen_screen', 'call_screen'] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/devices/activate',
        headers: bearer(s.accessToken),
        payload: { method: 'owner', branchId: branch, ...deviceFields(`جهاز ${kind}`), kind },
      });
      expect(res.statusCode, `${kind}: ${res.body}`).toBe(201);
    }
    const over = await app.inject({
      method: 'POST',
      url: '/v1/devices/activate',
      headers: bearer(s.accessToken),
      payload: { method: 'owner', branchId: branch, ...deviceFields('كاشير زائد'), kind: 'cashier' },
    });
    expect(over.statusCode).toBe(403);
    expect(over.json().error.code).toBe('plan_limit_reached');
  });
});
