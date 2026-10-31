import type { ActivatedDevice, PendingActivation } from '@serva/core';
import * as syncClient from '@serva/sync/client';
import type { DeviceRecord, SyncStore, SyncTransport } from '@serva/sync/client';
import type { DexieSyncStore } from '@serva/sync/dexie';

/**
 * The device side of linking (12 › ربط الجهاز, 15 › التثبيت خطوة بخطوة): the key pair, saving the
 * activated device and the first download. `@serva/sync/client` provides these; this thin adapter
 * is the one place the screens reach them, so tests pass fakes and the screens never change when
 * the package does.
 */
export interface BootstrapProgress {
  received: number;
  total: number;
}

export interface LinkHelpers {
  /** ECDSA P-256; the private key never leaves the device. Returns the SPKI public key, base64url. */
  createDeviceKeys(store: SyncStore): Promise<{ publicKey: string }>;
  /** Writes the device record (token, numbering codes, names). */
  saveActivatedDevice(store: SyncStore, device: ActivatedDevice): Promise<DeviceRecord>;
  /** Downloads the store snapshot (resumes after a cut), checks it and applies it in one go. */
  runBootstrap(opts: {
    store: SyncStore;
    transport: SyncTransport;
    onProgress?: (p: BootstrapProgress) => void;
  }): Promise<void>;
}

interface KeyRow {
  key: string;
  value: unknown;
}

interface KeyTable {
  get(key: string): Promise<KeyRow | undefined>;
  put(row: KeyRow): Promise<unknown>;
  delete(key: string): Promise<void>;
}

/** The meta table of the device database holds a few extra rows beside the sync state. */
function metaTable(store: SyncStore) {
  const { db } = store as Partial<DexieSyncStore>;
  return (db?.meta as unknown as KeyTable | undefined) ?? null;
}

export const linkHelpers: LinkHelpers = {
  createDeviceKeys: syncClient.createDeviceKeys,
  saveActivatedDevice: syncClient.saveActivatedDevice,
  runBootstrap: syncClient.runBootstrap,
};

/** Kept while the owner decides, so a reload goes on waiting (step 3). */
export interface SavedLink extends PendingActivation {
  method: 'qr' | 'code';
  /** The typed code, shown again on the waiting screen («XXXX-XXXX») */
  manualCode: string | null;
  requestedAt: string;
}

const LINK_KEY = 'pendingLink';

export async function loadPendingLink(store: SyncStore): Promise<SavedLink | null> {
  try {
    const row = await metaTable(store)?.get(LINK_KEY);
    return (row?.value as SavedLink | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function savePendingLink(store: SyncStore, link: SavedLink): Promise<void> {
  await metaTable(store)?.put({ key: LINK_KEY, value: link });
}

export async function clearPendingLink(store: SyncStore): Promise<void> {
  await metaTable(store)?.delete(LINK_KEY);
}
