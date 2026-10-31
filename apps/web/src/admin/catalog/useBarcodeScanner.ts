import { useEffect, useRef } from 'react';

/**
 * A USB or Bluetooth scanner is a keyboard that types a whole code in a few milliseconds and ends
 * with Enter. People type far slower: a gap longer than this starts a new code.
 */
export const SCANNER_KEY_GAP_MS = 60;
const MIN_CODE_LENGTH = 3;

function typingInAField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Catches a scan while no field has the focus, so the owner can scan a product on the list without
 * clicking the search box first. A scan into a field is that field's own Enter.
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true): void {
  const latest = useRef(onScan);
  useEffect(() => {
    latest.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;
    let buffer = '';
    let lastKeyAt = 0;
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || typingInAField(event.target)) {
        buffer = '';
        return;
      }
      const now = event.timeStamp || performance.now();
      if (now - lastKeyAt > SCANNER_KEY_GAP_MS) buffer = '';
      lastKeyAt = now;
      if (event.key === 'Enter') {
        if (buffer.length >= MIN_CODE_LENGTH) {
          event.preventDefault();
          latest.current(buffer);
        }
        buffer = '';
        return;
      }
      if (event.key.length === 1) buffer += event.key;
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
