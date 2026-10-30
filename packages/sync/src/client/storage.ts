/**
 * Persistent storage and disk space (15 › ما يُحفظ على الجهاز):
 * - the app asks the browser not to evict its data (navigator.storage.persist()) and then checks
 *   the answer with persisted(), because a browser may refuse silently. Refused: the device shows
 *   a red warning and is treated as unsafe for days offline;
 * - space is checked regularly and the device warns before the limit. The outbox is never what
 *   gets cleared.
 */

/** The parts of the browser's StorageManager used here (navigator.storage). */
export interface StorageManagerLike {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
}

export type StorageLevel = 'ok' | 'low' | 'full' | 'unknown';

export interface StorageStatus {
  /** true: the browser will keep the data; false: it may evict it; null: no such API (native build) */
  persisted: boolean | null;
  quota: number | null;
  usage: number | null;
  level: StorageLevel;
}

/** Warn when this share of the quota is used, or less than this much is free. */
export const STORAGE_LOW_RATIO = 0.8;
export const STORAGE_LOW_FREE_BYTES = 200 * 1024 * 1024;
export const STORAGE_FULL_RATIO = 0.95;

export function storageLevel(usage: number | null, quota: number | null): StorageLevel {
  if (usage === null || quota === null || quota <= 0) return 'unknown';
  const ratio = usage / quota;
  if (ratio >= STORAGE_FULL_RATIO) return 'full';
  if (ratio >= STORAGE_LOW_RATIO || quota - usage < STORAGE_LOW_FREE_BYTES) return 'low';
  return 'ok';
}

/** Asks for persistent storage (once granted it stays) and reports the space used. */
export async function ensurePersistentStorage(
  storage: StorageManagerLike | undefined,
): Promise<StorageStatus> {
  let persisted: boolean | null = null;
  try {
    if (storage?.persisted) {
      persisted = await storage.persisted();
      if (!persisted && storage.persist) {
        await storage.persist();
        // The answer of persist() is not trusted on its own: ask again.
        persisted = await storage.persisted();
      }
    } else if (storage?.persist) {
      persisted = await storage.persist();
    }
  } catch {
    persisted = false;
  }
  const { quota, usage } = await estimateStorage(storage);
  return { persisted, quota, usage, level: storageLevel(usage, quota) };
}

export async function estimateStorage(
  storage: StorageManagerLike | undefined,
): Promise<{ quota: number | null; usage: number | null }> {
  try {
    const estimate = await storage?.estimate?.();
    return { quota: estimate?.quota ?? null, usage: estimate?.usage ?? null };
  } catch {
    return { quota: null, usage: null };
  }
}
