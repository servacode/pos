import { randomBytes } from 'node:crypto';

/**
 * A UUIDv7: 48-bit Unix time in milliseconds, then random bits. Ids sort by creation time, so
 * inserts do not scatter indexes. Same layout as the database's uuid_generate_v7().
 */
export function uuidv7(timeMs: number = Date.now()): string {
  const bytes = randomBytes(16);
  let ms = timeMs;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
