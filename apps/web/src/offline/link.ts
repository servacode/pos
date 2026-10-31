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

function base64url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

// Stand-ins used only while the package does not export the helpers yet.
const fallback: LinkHelpers = {
  async createDeviceKeys(store) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'sign',
      'verify',
    ]);
    await metaTable(store)?.put({ key: 'deviceKeys', value: pair });
    return { publicKey: base64url(await crypto.subtle.exportKey('spki', pair.publicKey)) };
  },
  async saveActivatedDevice(store, device) {
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
    await store.setMeta({ serverEpoch: device.serverEpoch });
    return record;
  },
  // Without a snapshot the first pull downloads everything from empty cursors.
  async runBootstrap() {},
};

const provided = syncClient as unknown as Partial<LinkHelpers>;

export const linkHelpers: LinkHelpers = {
  createDeviceKeys: provided.createDeviceKeys ?? fallback.createDeviceKeys,
  saveActivatedDevice: provided.saveActivatedDevice ?? fallback.saveActivatedDevice,
  runBootstrap: provided.runBootstrap ?? fallback.runBootstrap,
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
