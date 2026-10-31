import type { DeviceRecord, SyncStore } from './store';

/**
 * What the server answers once a device is active (`ActivatedDevice` in @serva/core's devices
 * contract; the same fields, so that type is accepted here as it is).
 */
export interface ActivatedDeviceInfo {
  deviceId: string;
  token: string;
  deviceCode: string;
  branchCode: string;
  storeName: string;
  branchName: string;
  deviceName: string;
  serverEpoch: number;
}

function base64url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Makes the device's own key pair (09 › devices: a public key on the server, the private key kept
 * on the device): ECDSA P-256 through WebCrypto, the private key not extractable, both kept in the
 * device database. Returns the public key as SPKI, base64url, for POST /v1/devices/activate.
 * A new pair replaces any earlier one: each link starts afresh.
 */
export async function createDeviceKeys(store: SyncStore): Promise<{ publicKey: string }> {
  const keys = await globalThis.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ]);
  await store.putDeviceKeys(keys);
  return { publicKey: base64url(await globalThis.crypto.subtle.exportKey('spki', keys.publicKey)) };
}

/**
 * Keeps an activated device: its id, its token (shown once by the server), its numbering codes and
 * the names the cashier screens show, and the server epoch it was activated under. Run
 * runBootstrap() next.
 */
export async function saveActivatedDevice(
  store: SyncStore,
  device: ActivatedDeviceInfo,
): Promise<DeviceRecord> {
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
}
