import { useEffect, useRef } from 'react';

/**
 * Round 62: a dialog opens with the cursor in its window, not on the close button (which would show a blue ring over a
 * document the person only wants to read). Put the returned ref on a `tabIndex={-1}` element at the top of the content.
 */
export function useQuietFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    // After the dialog's own focus move (it lands on the first button)
    const timer = setTimeout(() => ref.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(timer);
  }, []);
  return ref;
}
