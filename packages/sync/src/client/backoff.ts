/**
 * Retry delays while the server cannot be reached (15 › الإرسال): from 2 seconds, doubling, up to
 * 5 minutes. A ±20% jitter keeps a shop's devices from all reconnecting in the same instant.
 */
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

export function backoffDelay(failures: number, random: () => number = Math.random): number {
  if (failures <= 0) return 0;
  const exponent = Math.min(failures - 1, 20);
  const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent);
  const jittered = delay * (0.8 + 0.4 * random());
  return Math.round(Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_BASE_MS * 0.8, jittered)));
}
