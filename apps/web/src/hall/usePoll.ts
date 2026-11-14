import { useCallback, useEffect, useRef, useState } from 'react';
import type { HallAnswer } from './api';

export interface Polled<T> {
  data: T | null;
  /** false after a call got no answer: the screen keeps the last data and says so */
  online: boolean;
  /** The server's last refusal, if any (a revoked device, a store that stopped) */
  refusal: string | null;
  /** Loads now, e.g. after a command */
  refresh: () => Promise<void>;
  /** Shows an answer the screen already has (a command returns the fresh state) */
  set: (data: T) => void;
}

/**
 * Reads `load` now and every `ms`: the kitchen and the waiter work by polling every few seconds
 * (03 › وضع النادل: «يصل المطبخ فوراً» is the local hub's job later; through the server it is seconds).
 */
export function usePoll<T>(load: () => Promise<HallAnswer<T>>, ms: number): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [online, setOnline] = useState(true);
  const [refusal, setRefusal] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const answer = await loadRef.current();
    if (!alive.current) return;
    if (answer.kind === 'ok') {
      setData(answer.body);
      setOnline(true);
      setRefusal(null);
    } else if (answer.kind === 'network') {
      setOnline(false);
    } else {
      setRefusal(answer.message);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), ms);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [refresh, ms]);

  return { data, online, refusal, refresh, set: setData };
}
