import {
  createFetchTransport,
  ensurePersistentStorage,
  SyncEngine,
  type DeviceRecord,
  type StorageStatus,
  type SyncState,
  type SyncStore,
  type SyncTransport,
} from '@serva/sync/client';

export const APP_VERSION = '0.0.0';

/**
 * Asks the browser to keep this device's data and records the answer (tab 15: refused means a red
 * warning and the device is not safe for days offline).
 */
export async function checkStorage(
  store: SyncStore,
  storage: Parameters<typeof ensurePersistentStorage>[0] = globalThis.navigator?.storage,
): Promise<StorageStatus> {
  const status = await ensurePersistentStorage(storage);
  await store.setMeta({ storagePersisted: status.persisted }).catch(() => undefined);
  return status;
}

/** HTTP transport authenticated with this device's token, read again on every request. */
export function deviceTransport(store: SyncStore): SyncTransport {
  return createFetchTransport({
    getToken: async () => (await store.getDevice())?.token ?? null,
    appVersion: APP_VERSION,
  });
}

/**
 * Starts the push and pull loops for an activated device (one with a token). Returns null for a
 * device that is only named, since it has nothing to authenticate with yet.
 */
export function startSync(
  store: SyncStore,
  device: DeviceRecord,
  onState?: (state: SyncState) => void,
): SyncEngine | null {
  if (!device.token) return null;
  const engine = new SyncEngine({
    store,
    transport: deviceTransport(store),
    appVersion: APP_VERSION,
    isOnline: () => globalThis.navigator?.onLine ?? true,
    onState,
  });
  engine.start();
  return engine;
}
