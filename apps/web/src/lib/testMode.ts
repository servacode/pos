import { useSyncExternalStore } from 'react';

/**
 * The local server's test mode (sign-up codes shown on screen). The API marks every answer with
 * this header while it is on; the last answer seen is kept, so the cashier, which opens without a
 * request, still shows the ribbon.
 */
export const TEST_MODE_HEADER = 'x-serva-test-mode';
const STORAGE_KEY = 'serva.testMode';

const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let testMode = readStored();

export function setTestMode(on: boolean): void {
  if (on === testMode) return;
  testMode = on;
  try {
    if (on) globalThis.localStorage?.setItem(STORAGE_KEY, '1');
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or full storage: the ribbon still shows for this visit.
  }
  for (const listener of listeners) listener();
}

/** Reads the mark from an API answer. A proxy error (5xx) may not come from the API: ignored. */
export function noteTestMode(res: Response): void {
  if (res.status >= 500) return;
  setTestMode(res.headers.get(TEST_MODE_HEADER) === '1');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTestMode(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => testMode,
    () => false,
  );
}
