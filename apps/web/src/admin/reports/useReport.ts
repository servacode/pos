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

/** For screens that load by themselves: keep an answer under a name, and read the last one back */
export function rememberAnswer(key: string, value: unknown): void {
  lastAnswers.set(key, value);
}
export function recallAnswer<T>(key: string): T | null {
  return (lastAnswers.get(key) as T | undefined) ?? null;
}

export function clearReportCache(): void {
  lastAnswers.clear();
}

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
        if (cacheKey) lastAnswers.set(cacheKey, data);
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
  const stale = !fresh && cacheKey !== null ? ((lastAnswers.get(cacheKey) as T | undefined) ?? null) : null;
  const loading = key !== null && !fresh;
  const waiting = loading && (fresh ? state.data : stale) === null;
  const [slow, setSlow] = useState(false);
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
  };
}
