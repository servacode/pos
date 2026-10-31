import { useEffect, useRef } from 'react';
import { toLatinDigits } from '@serva/core/text';

/** A scanner types a whole code within a few dozen milliseconds and ends it with Enter. */
export const SCAN_GAP_MS = 60;
export const SCAN_MIN_LENGTH = 3;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !['button', 'checkbox', 'radio'].includes(target.type);
  return false;
}

export interface ScannerOptions {
  enabled: boolean;
  onScan: (code: string) => void;
  /** «3 ثم *»: the quantity of the next item */
  onMultiplier?: (count: number) => void;
  /** Shortest code taken as a scan; longer while amounts are typed with Enter (the payment) */
  minLength?: number;
  now?: () => number;
}

/**
 * Hears the barcode scanner from anywhere on the sale screen, without a focused field (12 ›
 * شاشة البيع): fast keys ending with Enter make a code. Keys typed into a field are left to it
 * (the search field handles its own Enter). Digits typed slowly then «*» set the next quantity.
 */
export function useScanner({
  enabled,
  onScan,
  onMultiplier,
  minLength = SCAN_MIN_LENGTH,
  now = () => performance.now(),
}: ScannerOptions) {
  // `burst`: keys typed with no pause (a scan); `digits`: digits typed at any speed (for «3 ثم *»).
  const buffer = useRef({ burst: '', digits: '', last: 0 });
  const latest = useRef({ onScan, onMultiplier, now, minLength });
  latest.current = { onScan, onMultiplier, now, minLength };

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || isEditable(event.target)) return;
      const { onScan, onMultiplier, now, minLength } = latest.current;
      const b = buffer.current;
      const t = now();
      if (event.key === 'Enter') {
        if (b.burst.length >= minLength && t - b.last <= SCAN_GAP_MS * 4) {
          // Keep Enter from also pressing the focused button.
          event.preventDefault();
          event.stopPropagation();
          onScan(b.burst);
        }
        b.burst = '';
        b.digits = '';
        return;
      }
      if ((event.key === '*' || event.key === '×') && /^\d{1,3}$/.test(b.digits)) {
        event.preventDefault();
        if (Number(b.digits) > 0) onMultiplier?.(Number(b.digits));
        b.burst = '';
        b.digits = '';
        return;
      }
      if (event.key.length !== 1) return;
      const ch = toLatinDigits(event.key);
      b.burst = b.burst && t - b.last <= SCAN_GAP_MS ? b.burst + ch : ch;
      b.digits = /\d/.test(ch) ? b.digits + ch : '';
      b.last = t;
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}
