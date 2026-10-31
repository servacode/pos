import type { DeviceRecord, SyncStore } from '@serva/sync/client';

/** What the cashier screens show about this device. */
export type LocalDevice = Pick<DeviceRecord, 'storeName' | 'branchName' | 'deviceName'>;

/** Where step 1 kept the linked-device record; moved into the device database on first read. */
export const LEGACY_DEVICE_KEY = 'serva.pos.device';

function readLegacy(storage: Pick<Storage, 'getItem'> | undefined): LocalDevice | null {
  try {
    const raw = storage?.getItem(LEGACY_DEVICE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    const ok = ['storeName', 'branchName', 'deviceName'].every(
      (key) => typeof record[key] === 'string' && record[key] !== '',
    );
    return ok ? (record as unknown as LocalDevice) : null;
  } catch {
    // Storage blocked (private mode, kiosk policy) or a damaged record: treat as not linked.
    return null;
  }
}

/**
 * The device record, from the device database. A record left in localStorage by step 1 is moved
 * there once (names only: it was never activated, so it has no token or numbering codes).
 * Resolves to null for a device that is not linked, or when the database cannot be opened.
 */
export async function loadDevice(
  store: SyncStore,
  legacy: Pick<Storage, 'getItem' | 'removeItem'> | undefined = globalThis.localStorage,
): Promise<DeviceRecord | null> {
  try {
    const existing = await store.getDevice();
    if (existing) return existing;
    const old = readLegacy(legacy);
    if (!old) return null;
    const device: DeviceRecord = {
      storeName: old.storeName,
      branchName: old.branchName,
      deviceName: old.deviceName,
      deviceId: null,
      token: null,
      branchCode: null,
      deviceCode: null,
      sets: [],
    };
    await store.putDevice(device);
    try {
      legacy?.removeItem(LEGACY_DEVICE_KEY);
    } catch {
      // Blocked storage: the record is already in the database, which is read first.
    }
    return device;
  } catch {
    return null;
  }
}
