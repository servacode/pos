import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../lib/api';

export interface ReportState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  retry: () => void;
}

/**
 * Loads a report for the current filters. `key` names the filters: a new key loads again, and an
 * answer for an older key that arrives late is dropped, so the screen never shows another day's
 * numbers under today's title.
 */
export function useReport<T>(key: string | null, load: () => Promise<T>): ReportState<T> {
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
      (data) => current && setState({ key, data, error: null }),
      (error: unknown) => current && setState({ key, data: null, error: errorMessage(error) }),
    );
    return () => {
      current = false;
    };
  }, [key, attempt]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, key: null, error: null }));
    setAttempt((n) => n + 1);
  }, []);

  const fresh = state.key === key && key !== null;
  return {
    data: fresh ? state.data : null,
    error: fresh ? state.error : null,
    loading: key !== null && !fresh,
    retry,
  };
}
