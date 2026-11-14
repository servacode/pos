import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HallOrder } from '@serva/core';
import { createHallApi, type HallApi } from '../../hall/api';

export interface ServerHall {
  /** null while offline or when the store has no tables: the till then works on its own held carts */
  api: HallApi | null;
  orders: HallOrder[];
  /** The last read got an answer */
  reachable: boolean;
  refresh: () => Promise<void>;
}

/**
 * The server's open orders for the table board, read every few seconds while the till is online
 * and the store has tables (03 › وضع النادل). The first answer that does not come clears them, so
 * the board falls back to the till's own held carts exactly as it always worked.
 */
export function useServerHall(options: {
  enabled: boolean;
  token: string | null;
  fetchFn?: typeof fetch;
  pollMs?: number;
}): ServerHall {
  const { enabled, token, fetchFn, pollMs = 5000 } = options;
  const api = useMemo(
    () => (enabled && token ? createHallApi(token, fetchFn) : null),
    [enabled, token, fetchFn],
  );
  const [orders, setOrders] = useState<HallOrder[]>([]);
  const [reachable, setReachable] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!api) return;
    const answer = await api.hall();
    if (!alive.current) return;
    setOrders(answer.kind === 'ok' ? answer.body.orders : []);
    setReachable(answer.kind === 'ok');
  }, [api]);

  useEffect(() => {
    alive.current = true;
    if (!api) {
      setOrders([]);
      setReachable(false);
      return;
    }
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [api, refresh, pollMs]);

  return { api, orders, reachable, refresh };
}
