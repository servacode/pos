import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ProductDetail, RepRow, TillProductPlaced, VanRow } from '@serva/core';
import type { PullResponse } from '@serva/sync';
import { hashDeviceToken } from '../src/auth/device-guard';
import { withTenant } from '@serva/db';
import { checkIntegrity, ledgerFingerprint, stockFingerprint } from '../src/services/integrity';
import {
  cartLine,
  documents,
  newId,
  openStore,
  push,
  sale,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { createDevice, type TestDevice } from './devices';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase, settled } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

/**
 * Round 38, dfix38: the rep phone's staff list (a pull scope), and a product made at the till without a connection
 * (a `temp_item` document that creates it under the ids the till already sold it by). The agent's remembered
 * device is in agents.test.ts beside the rest of the agent's sign-in.
 */

const books = (tenantId: string) =>
  withTenant(appDb().db, tenantId, async (tx) => ({
    ledger: (await ledgerFingerprint(tx, tenantId)).hash,
    stock: (await stockFingerprint(tx, tenantId)).hash,
    report: await checkIntegrity(tx, tenantId),
  }));

let app: FastifyInstance;
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
});

// ─── The rep phone's staff list ──────────────────────────────────────────────

describe('a rep phone lists only the people the server lets in', () => {
  let s: TestStore;
  beforeEach(async () => {
    s = await testStore(app);
  });
  let n = 0;
  const phone = () => `0955${String(++n).padStart(6, '0')}`;
  const ok = async <T>(method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, status = 200) => {
    const res = await app.inject({
      method,
      url,
      headers: bearer(s.accessToken),
      ...(payload ? { payload: payload as object } : {}),
    });
    expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(status);
    return res.json<T>();
  };
  const van = (tag: string) =>
    ok<VanRow>('POST', '/v1/vans', { name: `سيارة ${tag}`, parentBranchId: s.branchId }, 201);
  async function repOn(vanRow: VanRow) {
    const user = await staffUser(app, s, 'rep', phone());
    const rep = await ok<RepRow>(
      'POST',
      '/v1/reps',
      { userId: user.userId, branchId: s.branchId, vanBranchId: vanRow.id },
      201,
    );
    return { userId: user.userId, rep };
  }
  async function repPhone(branchId: string, code: string): Promise<TestDevice> {
    const token = `sdt_${randomBytes(32).toString('base64url')}`;
    const [row] = await ownerDb()<{ id: string }[]>`
      insert into devices (tenant_id, branch_id, code, name, kind, status, token_hash)
      values (${s.tenantId}, ${branchId}, ${code}, ${`هاتف ${code}`}, 'rep_phone', 'active', ${hashDeviceToken(token)})
      returning id`;
    return {
      deviceId: row!.id,
      tenantId: s.tenantId,
      branchId,
      code,
      token,
      authorization: `Device ${token}`,
    };
  }
  const pull = async (device: TestDevice, cursors?: Record<string, string>) => {
    await settled();
    const res = await app.inject({
      method: 'GET',
      url: cursors ? `/v1/sync/pull?cursors=${encodeURIComponent(JSON.stringify(cursors))}` : '/v1/sync/pull',
      headers: { authorization: device.authorization },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<PullResponse>();
  };
  const names = (page: PullResponse) =>
    (page.sets.users?.upserts ?? []).map((u) => String(u.fullName)).toSorted();

  it('the van’s rep, a manager and the owner on a van’s phone; a till still lists everyone', async () => {
    const v1 = await van('1');
    const v2 = await van('2');
    const mine = await repOn(v1);
    const other = await repOn(v2);
    await staffUser(app, s, 'cashier', phone(), { fullName: 'كاشير' });
    await staffUser(app, s, 'manager', phone(), { fullName: 'مدير' });
    const phoneOfV1 = await repPhone(v1.id, '002');
    const till = await createDevice(s.tenantId);

    const page = await pull(phoneOfV1);
    // Everyone's name is the same default here: tell them apart by id
    const ids = (page.sets.users?.upserts ?? []).map((u) => u.id).toSorted();
    expect(ids).toContain(mine.userId);
    expect(ids).toContain(s.userId);
    expect(ids).not.toContain(other.userId);
    expect(names(page)).not.toContain('كاشير');
    expect(names(page)).toContain('مدير');
    // The role rows come only for the same people
    const roleUsers = new Set((page.sets.user_roles?.upserts ?? []).map((r) => String(r.userId)));
    expect(roleUsers.has(mine.userId)).toBe(true);
    expect(roleUsers.has(other.userId)).toBe(false);
    expect(ids).toHaveLength(roleUsers.size);

    // The till is unchanged: all of them
    const all = (await pull(till)).sets.users!.upserts.map((u) => u.id);
    expect(all).toEqual(expect.arrayContaining([mine.userId, other.userId, s.userId]));
    expect(all.length).toBe(5);
  });

  it('a rep who stops, or a new manager, makes the phone download the two sets again', async () => {
    const v1 = await van('1');
    const mine = await repOn(v1);
    const device = await repPhone(v1.id, '002');
    const first = await pull(device);
    const cursors = Object.fromEntries(Object.entries(first.sets).map(([name, page]) => [name, page.cursor]));
    // Nothing owed yet
    await ownerDb()`update devices set resync_sets = '{}' where id = ${device.deviceId}`;
    expect((await pull(device, cursors)).commands?.resync ?? []).toEqual([]);

    // The rep is stopped: the next pull asks for the two sets again, and then no longer lists him
    await ok('POST', `/v1/reps/${mine.rep.id}/active`, { active: false });
    expect(
      (
        await ownerDb()<
          { resync_sets: string[] }[]
        >`select resync_sets from devices where id = ${device.deviceId}`
      )[0]!.resync_sets.toSorted(),
    ).toEqual(['user_roles', 'users']);
    const asked = await pull(device, cursors);
    expect([...(asked.commands?.resync ?? [])].toSorted()).toEqual(['user_roles', 'users']);
    const fresh = await pull(device);
    const ids = (fresh.sets.users?.upserts ?? []).map((u) => u.id);
    expect(ids).not.toContain(mine.userId);
    expect(ids).toContain(s.userId);
  });

  it('saving a rep or a staff role flags every rep phone to download its staff again', async () => {
    const v1 = await van('1');
    const device = await repPhone(v1.id, '002');
    const flagged = async () =>
      (
        await ownerDb()<
          { resync_sets: string[] }[]
        >`select resync_sets from devices where id = ${device.deviceId}`
      )[0]!.resync_sets.toSorted();
    await ownerDb()`update devices set resync_sets = '{}' where id = ${device.deviceId}`;
    await repOn(v1);
    expect(await flagged()).toEqual(['user_roles', 'users']);
    await ownerDb()`update devices set resync_sets = '{}' where id = ${device.deviceId}`;
    await ok(
      'POST',
      '/v1/staff',
      { fullName: 'مدير جديد', roleKey: 'manager', branchIds: null, pin: '284913' },
      201,
    );
    expect(await flagged()).toEqual(['user_roles', 'users']);
  });
});

// ─── A product made at the till without a connection ─────────────────────────

describe('a product made at the till offline (temp_item)', () => {
  const BARCODE = '6291041500213';
  const payload = (store: Store, over: Record<string, unknown> = {}) => ({
    productId: newId(),
    variantId: newId(),
    actorId: store.userId,
    nameAr: 'قميص أزرق',
    priceMinor: 450_000,
    currency: 'SYP',
    categoryId: null,
    barcode: BARCODE,
    approval: null,
    ...over,
  });
  const products = (tenantId: string) =>
    ownerDb()<{ id: string; status: string; name_ar: string }[]>`
      select id, status, name_ar from products where tenant_id = ${tenantId}`;

  it('is written under the till’s own ids, awaiting review, and the sale made at once points at it', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const item = payload(store);
    const shiftId = newId();
    const made = doc('temp_item', item);
    const opened = doc('shift_open', { ...shiftOpen(store.userId), shiftId }, shiftId);
    // The cashier sold it right away: the sale line carries the variant the till made
    const soldPayload = sale(store, shiftId, {
      lines: [
        cartLine(1, 450_000, {
          productId: item.productId,
          variantId: item.variantId,
          name: item.nameAr,
        }),
      ],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 450_000 }],
    });
    const sold = doc('sale', soldPayload);
    const res = await push(app, store.device, [opened, made, sold]);
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);
    expect(res.results[1]).toMatchObject({ flags: [] });
    expect(res.results[1]!.flags).not.toContain('held_for_processing');

    const rows = await products(store.tenantId);
    expect(rows).toEqual([{ id: item.productId, status: 'temporary', name_ar: 'قميص أزرق' }]);
    const [variant] = await ownerDb()<
      { id: string }[]
    >`select id from variants where product_id = ${item.productId}`;
    expect(variant!.id).toBe(item.variantId);
    const [price] = await ownerDb()<
      { price_minor: string }[]
    >`select price_minor from prices where id = ${item.variantId}`;
    expect(Number(price!.price_minor)).toBe(450_000);
    const [code] = await ownerDb()<
      { code: string }[]
    >`select code from barcodes where variant_id = ${item.variantId}`;
    expect(code!.code).toBe(BARCODE);
    // The sale line already pointed at the real variant, and its stock moved on it
    const lines = await ownerDb()<{ variant_id: string }[]>`
      select variant_id from invoice_lines where tenant_id = ${store.tenantId}`;
    expect(lines.map((l) => l.variant_id)).toEqual([item.variantId]);
    const moved = await ownerDb()<{ qty: string }[]>`
      select qty from stock_movements where tenant_id = ${store.tenantId} and variant_id = ${item.variantId}`;
    expect(moved.map((m) => Number(m.qty))).toEqual([-1000]);
    // The product API reads it like any other
    const detail = await app.inject({
      method: 'GET',
      url: `/v1/products/${item.productId}`,
      headers: bearer(store.accessToken),
    });
    expect(detail.json<ProductDetail>()).toMatchObject({
      status: 'temporary',
      variants: [{ id: item.variantId }],
    });
    // Books and stock still agree with their movements
    const { report } = await books(store.tenantId);
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    // The pull brings the real rows (same ids) so the till drops its local copy
    await settled();
    const pulled = (
      await app.inject({
        method: 'GET',
        url: '/v1/sync/pull',
        headers: { authorization: store.device.authorization },
      })
    ).json<PullResponse>();
    expect(pulled.sets.products!.upserts.map((p) => p.id)).toContain(item.productId);
    expect(pulled.sets.variants!.upserts.map((v) => v.id)).toContain(item.variantId);
  });

  it('is written once: the same document again, or another document for the same product, makes no second one', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const item = payload(store);
    const first = doc('temp_item', item);
    const again = doc('temp_item', item);
    const res = await push(app, store.device, [first]);
    expect(res.results[0]!.status).toBe('accepted');
    const resent = await push(app, store.device, [first, again]);
    expect(resent.results[0]).toMatchObject({ status: 'duplicate', outcome: 'accepted' });
    expect(resent.results[1]!.status).toBe('accepted');
    expect(await products(store.tenantId)).toHaveLength(1);
    expect(await ownerDb()`select 1 from variants where tenant_id = ${store.tenantId}`).toHaveLength(1);
    expect(await ownerDb()`select 1 from barcodes where tenant_id = ${store.tenantId}`).toHaveLength(1);
    const audits = await ownerDb()`select 1 from audit_logs where action = 'product.created_at_till'`;
    expect(audits).toHaveLength(1);
  });

  it('after the online route made it (the answer was lost), the queued document makes nothing twice', async () => {
    const store = await openStore(app);
    const item = payload(store);
    const online = await app.inject({
      method: 'POST',
      url: '/v1/device/products',
      headers: { authorization: store.device.authorization },
      payload: {
        actorId: store.userId,
        nameAr: item.nameAr,
        priceMinor: item.priceMinor,
        categoryId: null,
        barcode: BARCODE,
        productId: item.productId,
        variantId: item.variantId,
      },
    });
    expect(online.statusCode, online.body).toBe(201);
    expect(online.json<TillProductPlaced>()).toMatchObject({
      productId: item.productId,
      variantId: item.variantId,
    });
    // The same ids asked again: the product that exists, no second one, no barcode conflict
    const twice = await app.inject({
      method: 'POST',
      url: '/v1/device/products',
      headers: { authorization: store.device.authorization },
      payload: {
        actorId: store.userId,
        nameAr: item.nameAr,
        priceMinor: item.priceMinor,
        categoryId: null,
        barcode: BARCODE,
        productId: item.productId,
        variantId: item.variantId,
      },
    });
    expect(twice.statusCode, twice.body).toBe(201);
    expect(twice.json<TillProductPlaced>().variantId).toBe(item.variantId);
    const res = await push(app, store.device, [documents(store.device)('temp_item', item)]);
    expect(res.results[0]).toMatchObject({ status: 'accepted', flags: [] });
    expect(await products(store.tenantId)).toHaveLength(1);
  });

  it('a barcode another product took meanwhile does not lose the sale: the product is made without it, flagged', async () => {
    const store = await openStore(app);
    const taken = await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: bearer(store.accessToken),
      payload: {
        nameAr: 'قميص وصل قبلك',
        variants: [
          { price: { currency: 'SYP', priceMinor: 1000 }, barcodes: [{ kind: 'standard', code: BARCODE }] },
        ],
      },
    });
    expect(taken.statusCode, taken.body).toBe(201);
    const doc = documents(store.device);
    const item = payload(store);
    const res = await push(app, store.device, [doc('temp_item', item)]);
    expect(res.results[0]).toMatchObject({ status: 'accepted', flags: ['duplicate_barcode'] });
    expect(await products(store.tenantId)).toHaveLength(2);
    expect(await ownerDb()`select 1 from barcodes where variant_id = ${item.variantId}`).toHaveLength(0);
    expect((await products(store.tenantId)).find((p) => p.id === item.productId)?.status).toBe('temporary');
  });

  it('keeps the permission rule: a cashier’s own add is flagged stale, a stranger and a broken payload are refused', async () => {
    const store = await openStore(app);
    const owned = {
      tenantId: store.tenantId,
      userId: store.userId,
      accessToken: store.accessToken,
      branchId: store.device.branchId,
    };
    const cashier = await staffUser(app, owned, 'cashier', '0955333444', { branchId: owned.branchId });
    const doc = documents(store.device);
    const stale = await push(app, store.device, [
      doc('temp_item', payload(store, { actorId: cashier.userId, barcode: '6291041500220' })),
    ]);
    expect(stale.results[0]).toMatchObject({ status: 'accepted', flags: ['permission_stale'] });
    const stranger = await push(app, store.device, [
      doc('temp_item', payload(store, { actorId: newId(), barcode: '6291041500237' })),
    ]);
    expect(stranger.results[0]).toMatchObject({ status: 'rejected', code: 'actor_unknown' });
    const broken = await push(app, store.device, [doc('temp_item', { nameAr: 'ناقص' })]);
    expect(broken.results[0]).toMatchObject({ status: 'rejected', code: 'invalid_payload' });
    // A manager's code typed offline is flagged for the owner, as every offline approval is
    const manager = await staffUser(app, owned, 'manager', '0955333555', { branchId: owned.branchId });
    const approved = await push(app, store.device, [
      doc(
        'temp_item',
        payload(store, {
          actorId: manager.userId,
          barcode: '6291041500244',
          approval: { userId: manager.userId, method: 'pin', at: '2026-10-30T08:50:00.000Z', offline: true },
        }),
      ),
    ]);
    expect(approved.results[0]).toMatchObject({ status: 'accepted', flags: ['approval_offline'] });
  });

  it('moves no money: the books and the stock are what the documents say', async () => {
    const store = await openStore(app);
    const before = await books(store.tenantId);
    await push(app, store.device, [documents(store.device)('temp_item', payload(store))]);
    const after = await books(store.tenantId);
    expect(after.ledger).toBe(before.ledger);
    expect(after.stock).toBe(before.stock);
    expect(after.report.checks.filter((c) => !c.ok)).toEqual([]);
  });
});
