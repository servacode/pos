import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** The browser's own connection flag: no request is made to find out. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

// ─── A connection that is there but too weak to use ──────────────────────────

/** A probe slower than this, or one that fails, counts against the connection. */
export const PROBE_TIMEOUT_MS = 4000;
/** This many such probes in a row make the connection «weak»: the till works as if offline. */
export const WEAK_AFTER = 2;
const PROBE_EVERY_MS = 15_000;

let weak = false;
let misses = 0;
const watchers = new Set<() => void>();

export const isWeakConnection = (): boolean => weak;

/** Feeds one probe result; exported so the rule is testable without a network. */
export function recordProbe(ok: boolean): void {
  misses = ok ? 0 : misses + 1;
  const next = misses >= WEAK_AFTER;
  if (next === weak) return;
  weak = next;
  for (const watcher of watchers) watcher();
}

/** Resets the rule (tests, and a device that is unlinked). */
export function resetProbe(): void {
  misses = 0;
  weak = false;
}

/**
 * Asks the server's /health every 15 seconds while the browser says it is online. Two answers in a
 * row that fail or take over four seconds make the connection weak, which `useReachable` reports as
 * offline (the sale goes on locally, the documents wait with their count), until one answer is fast.
 * Returns a stop function; nothing runs where there is no fetch (tests).
 */
export function startConnectionProbe(): () => void {
  if (typeof fetch !== 'function' || typeof window === 'undefined') return () => undefined;
  let stopped = false;
  const probe = async () => {
    if (stopped || !navigator.onLine) return;
    const control = new AbortController();
    const timer = window.setTimeout(() => control.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(`/health?probe=${String(Date.now())}`, {
        cache: 'no-store',
        signal: control.signal,
      });
      if (!stopped) recordProbe(response.ok);
    } catch {
      if (!stopped) recordProbe(false);
    } finally {
      window.clearTimeout(timer);
    }
  };
  void probe();
  const every = window.setInterval(() => void probe(), PROBE_EVERY_MS);
  const back = () => void probe();
  window.addEventListener('online', back);
  return () => {
    stopped = true;
    window.clearInterval(every);
    window.removeEventListener('online', back);
  };
}

function subscribeWeak(onChange: () => void): () => void {
  watchers.add(onChange);
  return () => watchers.delete(onChange);
}

/** Online by the browser and not too weak to use: what the till treats as «متصل». */
export function useReachable(): boolean {
  const browser = useOnline();
  const weakNow = useSyncExternalStore(
    subscribeWeak,
    () => weak,
    () => false,
  );
  return browser && !weakNow;
}
