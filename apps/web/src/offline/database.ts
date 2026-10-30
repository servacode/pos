import { DeviceDatabase, DexieSyncStore } from '@serva/sync/dexie';

/**
 * The one device database of this browser profile (IndexedDB through Dexie, tab 15 › مخطط قاعدة
 * الجهاز): device record, outbox, cursors, pulled sets and the document journal. Opened on first
 * use, so pages that never touch it (sign-up, the owner's screens) never load it.
 */
let store: DexieSyncStore | null = null;

export function deviceStore(): DexieSyncStore {
  store ??= new DexieSyncStore(new DeviceDatabase());
  return store;
}

/** Tests: close and delete the database so the next test starts from an empty device. */
export async function resetDeviceStore(): Promise<void> {
  if (!store) return;
  const { db } = store;
  store = null;
  db.close();
  await db.delete();
}
