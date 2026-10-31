import type { DeviceDatabase } from '@serva/sync/dexie';

/**
 * Small state the cashier keeps for itself on this device (the device database's `local` table):
 * the staff sign-in key and verifiers, lockouts, the open shift, a held cart, the last receipt.
 * Never sent to the server, and kept through a pull reset or a server restore.
 */
export interface LocalStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export function dexieLocal(db: DeviceDatabase): LocalStore {
  return {
    async get<T>(key: string) {
      const row = await db.local.get(key);
      return row ? (row.value as T) : null;
    },
    async set(key, value) {
      await db.local.put({ key, value });
    },
    async remove(key) {
      await db.local.delete(key);
    },
  };
}

/** Tests and previews: the same contract in memory. */
export function memoryLocal(): LocalStore {
  const values = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (values.has(key) ? (values.get(key) as T) : null),
    set: async (key, value) => void values.set(key, value),
    remove: async (key) => void values.delete(key),
  };
}
