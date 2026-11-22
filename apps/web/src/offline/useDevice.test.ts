import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncEngine, type DeviceRecord } from '@serva/sync/client';
import { deviceStore, resetDeviceStore } from './database';
import { useDevice } from './useDevice';

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
  vi.unstubAllGlobals();
  await resetDeviceStore();
});

describe('useDevice', () => {
  it('sends what waited as soon as the connection comes back, and stops listening once closed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { code: 'unavailable' } }), { status: 503 })),
    );
    await deviceStore().putDevice(activated);
    const syncNow = vi.spyOn(SyncEngine.prototype, 'syncNow');
    const { result, unmount } = renderHook(() => useDevice());
    await waitFor(() => expect(result.current.engineSave).not.toBeNull());

    const before = syncNow.mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(syncNow.mock.calls.length).toBe(before + 1);

    unmount();
    const afterClose = syncNow.mock.calls.length;
    window.dispatchEvent(new Event('online'));
    expect(syncNow.mock.calls.length).toBe(afterClose);
  });
});
