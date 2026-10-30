/** What a linked cashier device keeps on itself so it can open without the network. */
export interface LocalDevice {
  storeName: string;
  branchName: string;
  deviceName: string;
}

/**
 * Skeleton store: the linked-device record sits in localStorage under this key until device
 * linking and the offline store (IndexedDB through Dexie, tab 15) arrive. Reading it is
 * synchronous, so the login-code screen paints without waiting on anything.
 */
export const LOCAL_DEVICE_KEY = 'serva.pos.device';

function isLocalDevice(value: unknown): value is LocalDevice {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return ['storeName', 'branchName', 'deviceName'].every(
    (key) => typeof record[key] === 'string' && record[key] !== '',
  );
}

export function readLocalDevice(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): LocalDevice | null {
  try {
    const raw = storage?.getItem(LOCAL_DEVICE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return isLocalDevice(value) ? value : null;
  } catch {
    // Storage blocked (private mode, kiosk policy) or a damaged record: treat as not linked.
    return null;
  }
}
