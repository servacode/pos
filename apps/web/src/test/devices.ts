import type { ActivatedDevice, DeviceSummary, PairingCodeResponse, PendingActivation } from '@serva/core';
import type { DeviceRecord } from '@serva/sync/client';
import { vi } from 'vitest';
import type { LinkHelpers } from '../offline/link';

export const PUBLIC_KEY = `MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE${'A'.repeat(64)}`;

export const activatedDevice: ActivatedDevice = {
  deviceId: '0192a000-0000-7000-8000-000000000003',
  token: `sdt_${'b'.repeat(43)}`,
  deviceCode: '003',
  tenantId: 'tenant-1',
  storeName: 'مقهى الياسمين',
  branchId: 'branch-1',
  branchCode: '001',
  branchName: 'الرقة · شارع تل أبيض',
  deviceName: 'كاشير 3',
  serverEpoch: 1,
};

export function pendingActivation(overrides: Partial<PendingActivation> = {}): PendingActivation {
  return {
    status: 'pending_approval',
    activationId: 'act-1',
    activationSecret: `sda_${'c'.repeat(43)}`,
    storeName: 'مقهى الياسمين',
    branchName: 'الرقة · شارع تل أبيض',
    deviceName: 'كاشير 3',
    expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
    pollAfterSeconds: 3,
    ...overrides,
  };
}

/** Stand-ins for the @serva/sync/client helpers: they record what the screens asked for. */
export function fakeLinkHelpers(options: { bootstrap?: () => Promise<void> } = {}) {
  const helpers = {
    createDeviceKeys: vi.fn<LinkHelpers['createDeviceKeys']>(async () => ({ publicKey: PUBLIC_KEY })),
    saveActivatedDevice: vi.fn<LinkHelpers['saveActivatedDevice']>(async (store, device) => {
      const record: DeviceRecord = {
        storeName: device.storeName,
        branchName: device.branchName,
        deviceName: device.deviceName,
        deviceId: device.deviceId,
        token: device.token,
        branchCode: device.branchCode,
        deviceCode: device.deviceCode,
        sets: [],
      };
      await store.putDevice(record);
      return record;
    }),
    runBootstrap: vi.fn<LinkHelpers['runBootstrap']>(async ({ onProgress }) => {
      onProgress?.({ received: 40, total: 100 });
      await (options.bootstrap?.() ?? Promise.resolve());
      onProgress?.({ received: 100, total: 100 });
    }),
  };
  return helpers satisfies LinkHelpers;
}

export function deviceSummary(overrides: Partial<DeviceSummary> = {}): DeviceSummary {
  return {
    id: 'dev-1',
    name: 'كاشير 1',
    kind: 'cashier',
    platform: 'windows',
    status: 'active',
    code: '001',
    branchId: 'branch-1',
    branchName: 'الفرع الرئيسي',
    lastSeenAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    lastSyncAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    appVersion: '0.0.0',
    clockOffsetMs: 0,
    missingDocuments: 0,
    unsentCount: 0,
    createdAt: '2026-10-01T10:00:00.000Z',
    revokedAt: null,
    version: 1,
    ...overrides,
  };
}

export function pairingCode(overrides: Partial<PairingCodeResponse> = {}): PairingCodeResponse {
  return {
    pairingId: 'pair-1',
    branchId: 'branch-1',
    branchName: 'الفرع الرئيسي',
    qrPayload: `https://app.serva.sy/link#spq_${'Q'.repeat(22)}`,
    qrToken: `spq_${'Q'.repeat(22)}`,
    manualCode: 'K7QM4TZP',
    storeCode: '482130',
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    maxAttempts: 5,
    ...overrides,
  };
}
