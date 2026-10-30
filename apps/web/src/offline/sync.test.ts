import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceRecord } from '@serva/sync/client';
import { deviceStore, resetDeviceStore } from './database';
import { checkStorage, startSync } from './sync';

const activated: DeviceRecord = {
  storeName: 'مقهى الياسمين',
  branchName: 'الفرع الرئيسي',
  deviceName: 'كاشير 2',
  deviceId: '0192a000-0000-7000-8000-000000000002',
  token: `sdt_${'a'.repeat(43)}`,
  branchCode: '001',
  deviceCode: '002',
  sets: ['users'],
};

afterEach(async () => {
  vi.restoreAllMocks();
  await resetDeviceStore();
});

describe('offline wiring', () => {
  it('does not start syncing a device that was never activated', () => {
    expect(startSync(deviceStore(), { ...activated, token: null })).toBeNull();
  });

  it('an activated device sends its saved sales with its device token', async () => {
    const store = deviceStore();
    await store.putDevice(activated);
    const calls: Array<{ url: string; auth: string | undefined; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
        calls.push({ url, auth: headers.Authorization, body });
        return new Response(JSON.stringify({ error: { code: 'unavailable' } }), { status: 503 });
      }),
    );
    const engine = startSync(store, activated)!;
    engine.stop();
    const entry = await engine.save({
      type: 'sale',
      payload: { total: 1500, lines: [{ lineNo: 1, qty: 1000, price: 1500 }] },
      businessDate: '2026-10-30',
      engineVersion: '1.0.0',
    });
    expect(entry.doc.number).toBe('INV-001-002-0000001');
    await engine.syncNow();

    expect(calls[0]!.url).toBe('/v1/sync/push');
    expect(calls[0]!.auth).toBe(`Device ${activated.token}`);
    // The server was busy: the sale stays safely in the outbox for the next try.
    expect(await store.countPending()).toBe(1);
    expect(engine.current.failures).toBe(1);
  });

  it('records whether the browser keeps the data', async () => {
    const store = deviceStore();
    expect(await checkStorage(store, { persisted: async () => true })).toMatchObject({ persisted: true });
    expect((await store.getMeta()).storagePersisted).toBe(true);
  });
});
