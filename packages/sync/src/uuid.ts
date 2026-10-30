/**
 * Device-generated document ids (tab 15 › المعرّف وعدم التكرار): UUIDv7, 48-bit Unix time in ms,
 * then random bits. Same layout as the database's uuid_generate_v7(), so server and device ids sort
 * together.
 *
 * Ids from one generator are strictly increasing, even when the device clock steps back (an old
 * computer losing its time after a power cut, tab 15 › ساعة الجهاز) or many ids share a
 * millisecond: the time part never goes below the last one used, and a 12-bit counter in rand_a
 * orders ids within one millisecond (RFC 9562 §6.2, method 1).
 */

export const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}

/** The creation time (ms) carried by a UUIDv7. */
export function uuidV7Time(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

export interface UuidV7Source {
  now?: () => number;
  /** Fills the array with random bytes; crypto.getRandomValues by default */
  random?: (bytes: Uint8Array) => void;
}

const MAX_COUNTER = 0xfff;

export function createUuidV7(source: UuidV7Source = {}): () => string {
  const now = source.now ?? Date.now;
  const random = source.random ?? ((bytes: Uint8Array) => void globalThis.crypto.getRandomValues(bytes));
  let lastMs = -1;
  let counter = 0;

  return () => {
    const bytes = new Uint8Array(16);
    random(bytes);
    let ms = Math.max(0, Math.floor(now()));
    if (ms <= lastMs) {
      ms = lastMs;
      counter += 1;
      if (counter > MAX_COUNTER) {
        ms += 1;
        counter = 0;
      }
    } else {
      // Start low in the 12-bit space so many ids can follow in the same millisecond.
      counter = bytes[6]! & 0x07;
    }
    lastMs = ms;

    let t = ms;
    for (let i = 5; i >= 0; i--) {
      bytes[i] = t % 256;
      t = Math.floor(t / 256);
    }
    bytes[6] = 0x70 | ((counter >> 8) & 0x0f); // version 7 + counter high bits
    bytes[7] = counter & 0xff;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
    let hex = '';
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

/** The process-wide generator. */
export const uuidv7: () => string = createUuidV7();
