import { useEffect, useRef } from 'react';

const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Calls `onIdle` once nothing was touched or typed for `ms` (12 › الدخول: «بعد دقائق خمول يحددها
 * المالك»). Any touch, key or scroll starts the wait again.
 */
export function useIdle(ms: number, onIdle: () => void): void {
  const latest = useRef(onIdle);
  latest.current = onIdle;
  useEffect(() => {
    if (!(ms > 0)) return;
    let timer = setTimeout(() => latest.current(), ms);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => latest.current(), ms);
    };
    for (const type of ACTIVITY) window.addEventListener(type, reset, { capture: true, passive: true });
    return () => {
      clearTimeout(timer);
      for (const type of ACTIVITY) window.removeEventListener(type, reset, { capture: true });
    };
  }, [ms]);
}
