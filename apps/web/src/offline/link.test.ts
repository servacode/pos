import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { devicePublicKeySchema } from '@serva/core';
import { activatedDevice, pendingActivation } from '../test/devices';
import { deviceStore, resetDeviceStore } from './database';
import { clearPendingLink, linkHelpers, loadPendingLink, savePendingLink, type SavedLink } from './link';

afterEach(async () => {
  await resetDeviceStore();
});

describe('device linking adapter', () => {
  it('keeps the pending request in the device database until it is cleared', async () => {
    const store = deviceStore();
    expect(await loadPendingLink(store)).toBeNull();
    const link: SavedLink = {
      ...pendingActivation(),
      method: 'qr',
      manualCode: null,
      requestedAt: '2026-10-31T10:00:00.000Z',
    };
    await savePendingLink(store, link);
    expect(await loadPendingLink(store)).toEqual(link);
    // The sync state beside it is untouched.
    expect((await store.getMeta()).serverEpoch).toBeNull();
    await clearPendingLink(store);
    expect(await loadPendingLink(store)).toBeNull();
  });

  it('saves the activated device so the cashier boots from it', async () => {
    const store = deviceStore();
    await linkHelpers.saveActivatedDevice(store, activatedDevice);
    expect(await store.getDevice()).toMatchObject({
      deviceId: activatedDevice.deviceId,
      token: activatedDevice.token,
      branchCode: '001',
      deviceCode: '003',
      storeName: 'مقهى الياسمين',
      deviceName: 'كاشير 3',
    });
  });

  it('makes a P-256 key pair and gives the public key in the contract shape', async () => {
    const { publicKey } = await linkHelpers.createDeviceKeys(deviceStore());
    expect(devicePublicKeySchema.safeParse(publicKey).success).toBe(true);
  });
});
