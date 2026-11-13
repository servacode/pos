import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { EXPORT_ENTITIES, type ExportManifest } from '@serva/core';
import { csvCell } from '../src/services/export/store-export';
import { crc32 } from '../src/services/export/zip';
import {
  cartLine,
  documents,
  makeProduct,
  openStore,
  push,
  sale,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser } from './staff';

/**
 * The owner’s whole store as a ZIP (docs/specs/24-legal.md: بياناتك ملكك): complete, tenant-scoped,
 * read by the owner alone, with no password or PIN hash in it.
 */

// The shared test database is truncated before every test; on a busy disk that takes a while
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

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

/** A reader for the archive’s own central directory: names, inflated bytes, and the CRC-32 recorded. */
function unzip(buffer: Buffer): Map<string, { data: Buffer; crc: number }> {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(-1);
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const files = new Map<string, { data: Buffer; crc: number }>();
  for (let i = 0; i < count; i++) {
    expect(buffer.readUInt32LE(offset)).toBe(0x02014b50);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressed = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extra = buffer.readUInt16LE(offset + 30);
    const comment = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    expect(buffer.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = inflateRawSync(buffer.subarray(start, start + compressed));
    expect(data.length, name).toBe(size);
    expect(crc32(data), name).toBe(crc);
    files.set(name, { data, crc });
    offset += 46 + nameLength + extra + comment;
  }
  return files;
}

const get = (store: Pick<Store, 'accessToken'>) =>
  app.inject({ method: 'GET', url: '/v1/export', headers: bearer(store.accessToken) });

async function busyStore(phone = '0912345678') {
  const store = await openStore(app, phone);
  const tea = await makeProduct(app, store, 'شاي الربيع', 45_000);
  await makeProduct(app, store, 'سكر', 9_000);
  await app.inject({
    method: 'POST',
    url: '/v1/customers',
    headers: bearer(store.accessToken),
    payload: { name: 'أحمد الحلبي', phone: '0955555555' },
  });
  const supplier = await app.inject({
    method: 'POST',
    url: '/v1/suppliers',
    headers: bearer(store.accessToken),
    payload: { name: 'شركة النور' },
  });
  const doc = documents(store.device);
  const open = doc('shift_open', shiftOpen(store.userId));
  const sold = doc(
    'sale',
    sale(store, open.id, {
      lines: [cartLine(1, 45_000, { ...tea, qty: 2000 })],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 90_000 }],
    }),
  );
  await push(app, store.device, [open, sold]);
  return { store, supplierId: supplier.json().id as string };
}

describe('the archive writer', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.from('6789'), crc32(Buffer.from('12345')))).toBe(0xcbf43926);
  });

  it('csv cells: quoted, quotes doubled, formulas defanged, numbers and nulls plain', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(12500)).toBe('12500');
    expect(csvCell(true)).toBe('true');
    expect(csvCell('قميص "L"')).toBe('"قميص ""L"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-5')).toBe('"-5"');
    expect(csvCell('+963912345678')).toBe('"+963912345678"');
    expect(csvCell('-cmd')).toBe(`"'-cmd"`);
    expect(csvCell('-1.5')).toBe('"-1.5"');
    expect(csvCell('-1+HYPERLINK("x")')).toBe(`"'-1+HYPERLINK(""x"")"`);
    expect(csvCell('+1+cmd|calc')).toBe(`"'+1+cmd|calc"`);
    expect(csvCell('+963 912')).toBe(`"'+963 912"`);
    expect(csvCell('-.5')).toBe(`"'-.5"`);
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe('the store export', () => {
  it('has a JSON and a CSV for every entity, a manifest whose counts match the database', async () => {
    const { store } = await busyStore();
    const res = await get(store);
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="serva-export-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    const files = unzip(res.rawPayload);

    for (const entity of EXPORT_ENTITIES) {
      expect(files.has(`json/${entity}.json`), entity).toBe(true);
      expect(files.has(`csv/${entity}.csv`), entity).toBe(true);
    }
    expect(files.has('README.txt')).toBe(true);
    const manifest = JSON.parse(files.get('manifest.json')!.data.toString('utf8')) as ExportManifest;
    expect(manifest).toMatchObject({ format: 'serva-export', version: 1, tenantId: store.tenantId });
    expect(manifest.entities.map((e) => e.name)).toEqual([...EXPORT_ENTITIES]);

    const tableOf = (name: string) => (name === 'settings' ? 'tenant_settings' : name);
    for (const { name, rows } of manifest.entities) {
      const [counted] = await ownerDb().unsafe(
        `select count(*)::int as n from ${tableOf(name)} where tenant_id = '${store.tenantId}'`,
      );
      expect(rows, name).toBe(counted!.n);
      const json = JSON.parse(files.get(`json/${name}.json`)!.data.toString('utf8')) as unknown[];
      expect(json, name).toHaveLength(rows);
      const csv = files.get(`csv/${name}.csv`)!.data.toString('utf8');
      expect(csv.charCodeAt(0), name).toBe(0xfeff);
      // A header line, then one record per row (a record can hold line breaks inside quotes)
      expect(csv.split('\r\n')[0]!.length, name).toBeGreaterThan(0);
    }
    // The things a store owns are there: products, a sale with its lines and payments, a customer
    const rows = (name: string) => manifest.entities.find((e) => e.name === name)!.rows;
    expect(rows('products')).toBe(2);
    expect(rows('customers')).toBe(1);
    expect(rows('suppliers')).toBe(1);
    expect(rows('invoices')).toBe(1);
    expect(rows('invoice_lines')).toBeGreaterThanOrEqual(1);
    expect(rows('invoice_payments')).toBeGreaterThanOrEqual(1);
    expect(rows('shifts')).toBe(1);
    expect(rows('journal_entries')).toBeGreaterThanOrEqual(1);
    expect(rows('journal_lines')).toBeGreaterThanOrEqual(2);
    const products = JSON.parse(files.get('json/products.json')!.data.toString('utf8')) as {
      name_ar: string;
    }[];
    expect(products.map((p) => p.name_ar).sort()).toEqual(['سكر', 'شاي الربيع'].sort());
  });

  it('never carries a password or PIN hash', async () => {
    const { store } = await busyStore();
    await staffUser(app, { ...store, branchId: '' }, 'manager', '0933333333');
    const files = unzip((await get(store)).rawPayload);
    const users = JSON.parse(files.get('json/users.json')!.data.toString('utf8')) as Record<
      string,
      unknown
    >[];
    expect(users).toHaveLength(2);
    for (const user of users) {
      expect(Object.keys(user)).not.toEqual(expect.arrayContaining(['password_hash']));
      expect(user).not.toHaveProperty('password_hash');
      expect(user).not.toHaveProperty('pin_hash');
    }
    const csv = files.get('csv/users.csv')!.data.toString('utf8');
    expect(csv).not.toContain('password_hash');
    expect(csv).not.toContain('$argon');
    expect(files.get('json/users.json')!.data.toString('utf8')).not.toContain('argon');
  });

  it('is tenant-scoped: another store’s rows are not in it', async () => {
    const { store } = await busyStore('0911111111');
    const other = await busyStore('0922222222');
    const files = unzip((await get(store)).rawPayload);
    const manifest = JSON.parse(files.get('manifest.json')!.data.toString('utf8')) as ExportManifest;
    expect(manifest.tenantId).toBe(store.tenantId);
    for (const { name } of manifest.entities) {
      const text = files.get(`json/${name}.json`)!.data.toString('utf8');
      expect(text, name).not.toContain(other.store.tenantId);
    }
    expect(manifest.entities.find((e) => e.name === 'products')!.rows).toBe(2);
    expect(manifest.entities.find((e) => e.name === 'invoices')!.rows).toBe(1);
  });

  it('is the owner’s alone; a manager, a cashier and a stranger are refused', async () => {
    const { store } = await busyStore();
    const manager = await staffUser(app, { ...store, branchId: '' }, 'manager', '0933333333');
    const cashier = await staffUser(app, { ...store, branchId: '' }, 'cashier', '0944444444');
    expect((await get(manager)).statusCode).toBe(403);
    expect((await get(cashier)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/v1/export' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/export', headers: { authorization: 'Bearer forged' } }))
        .statusCode,
    ).toBe(401);
  });

  it('is audited, rate limited per store, and leaves no temporary file behind', async () => {
    const { store } = await busyStore();
    const before = readdirSync(tmpdir()).filter((f) => f.startsWith('serva-export-'));
    for (let i = 0; i < 6; i++) expect((await get(store)).statusCode, String(i)).toBe(200);
    const limited = await get(store);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    const audit = await ownerDb()`
      select user_id, data from audit_logs where tenant_id = ${store.tenantId} and action = 'store.export'`;
    expect(audit).toHaveLength(6);
    expect(audit[0]!.user_id).toBe(store.userId);
    const after = readdirSync(tmpdir()).filter((f) => f.startsWith('serva-export-'));
    expect(after.filter((f) => !before.includes(f))).toEqual([]);
  });

  it('is a GET: it reads the books and changes none of them', async () => {
    const { store } = await busyStore();
    const count = async () =>
      (
        await ownerDb().unsafe(
          `select (select count(*) from journal_entries)::int as j, (select count(*) from stock_movements)::int as m`,
        )
      )[0];
    const was = await count();
    expect((await get(store)).statusCode).toBe(200);
    expect(await count()).toEqual(was);
  });
});
