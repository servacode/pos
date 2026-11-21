import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../lib/api';

export interface ReportState<T> {
  data: T | null;
  error: string | null;
  /** True while the new answer loads; `data` may then be the last answer from before */
  loading: boolean;
  retry: () => void;
  /** True when no answer has come for 10 seconds and there is nothing older to show */
  slow: boolean;
  /** True when the answer has taken over 2 seconds, so the screen can say «جارٍ التحميل…» */
  late: boolean;
}

/**
 * Loads a report for the current filters. `key` names the filters: a new key loads again, and an
 * answer for an older key that arrives late is dropped, so the screen never shows another day's
 * numbers under today's title.
 */
// The last answer per screen and filters, kept in memory only, so a screen opens with the last
// numbers under a thin progress bar instead of a blank skeleton. It is wiped when anyone signs in or
// out, so one store never sees another's numbers.
const lastAnswers = new Map<string, unknown>();

// A full reload empties the memory above, so the home page's answers are also kept for the tab's
// session (sessionStorage: gone when the tab closes, wiped at sign-in and sign-out), and the page
// opens on the last numbers the same person saw.
const SESSION_PREFIX = 'serva.report.';
const SESSION_LIMIT = 100_000;

function sessionGet(cacheKey: string): unknown {
  try {
    const raw = globalThis.sessionStorage?.getItem(SESSION_PREFIX + cacheKey);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

function sessionSet(cacheKey: string, value: unknown): void {
  try {
    const text = JSON.stringify(value);
    if (text.length <= SESSION_LIMIT) globalThis.sessionStorage?.setItem(SESSION_PREFIX + cacheKey, text);
  } catch {
    // Storage refused or full: the memory copy still serves this page.
  }
}

function readLast(cacheKey: string): unknown {
  if (lastAnswers.has(cacheKey)) return lastAnswers.get(cacheKey);
  if (!cacheKey.startsWith('home|')) return undefined;
  const kept = sessionGet(cacheKey);
  if (kept !== undefined) lastAnswers.set(cacheKey, kept);
  return kept;
}

/** For screens that load by themselves: keep an answer under a name, and read the last one back */
export function rememberAnswer(key: string, value: unknown): void {
  lastAnswers.set(key, value);
}
export function recallAnswer<T>(key: string): T | null {
  return (lastAnswers.get(key) as T | undefined) ?? null;
}

export function clearReportCache(): void {
  lastAnswers.clear();
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return;
    for (const key of Object.keys(storage)) if (key.startsWith(SESSION_PREFIX)) storage.removeItem(key);
  } catch {
    // Nothing kept, or storage refused.
  }
}

/** After this long without an answer, a screen says «جارٍ التحميل…» */
export const LATE_AFTER_MS = 2_000;

/** After this long without an answer, a screen says so instead of staying a blank skeleton */
export const SLOW_AFTER_MS = 10_000;

export interface ReportOptions {
  /** Names the screen; with it the last answer is shown first while the new one loads */
  cache?: string;
}

export function useReport<T>(
  key: string | null,
  load: () => Promise<T>,
  options: ReportOptions = {},
): ReportState<T> {
  const cacheKey = options.cache && key !== null ? `${options.cache}|${key}` : null;
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({
    key: null,
    data: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (key === null) return;
    let current = true;
    loadRef.current().then(
      (data) => {
        if (!current) return;
        if (cacheKey) {
          lastAnswers.set(cacheKey, data);
          if (cacheKey.startsWith('home|')) sessionSet(cacheKey, data);
        }
        setState({ key, data, error: null });
      },
      (error: unknown) => current && setState({ key, data: null, error: errorMessage(error) }),
    );
    return () => {
      current = false;
    };
  }, [key, attempt, cacheKey]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, key: null, error: null }));
    setAttempt((n) => n + 1);
  }, []);

  const fresh = state.key === key && key !== null;
  const stale = !fresh && cacheKey !== null ? ((readLast(cacheKey) as T | undefined) ?? null) : null;
  const loading = key !== null && !fresh;
  const waiting = loading && (fresh ? state.data : stale) === null;
  const [slow, setSlow] = useState(false);
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!loading) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), LATE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [loading, key, attempt]);
  useEffect(() => {
    if (!waiting) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waiting, key, attempt]);
  return {
    data: fresh ? state.data : stale,
    error: fresh ? state.error : null,
    loading,
    retry,
    slow,
    late,
  };
}
