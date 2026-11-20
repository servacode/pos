import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * What every floating box of the shell shares: Esc and a click outside close it (Esc gives focus back
 * to what opened it), and the box is placed against its trigger in the window, inside 12 px of the
 * edges. A phone's bottom sheet ignores the placement (the stylesheet pins it to the bottom).
 */
export function usePopover<T extends HTMLElement = HTMLDivElement>(
  place: (
    anchor: DOMRect,
    box: DOMRect,
    view: { width: number; height: number },
  ) => { left: number; top: number },
) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const box = useRef<T>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const placeRef = useRef(place);
  placeRef.current = place;

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (box.current?.contains(target) || trigger.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(true);
      }
    };
    // Capture phase: Esc closes this box first, and the drawer or palette under it stays open.
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  // Placed before the first paint, and again when the window changes size.
  useLayoutEffect(() => {
    if (!open) {
      setAt(null);
      return;
    }
    const update = () => {
      if (!trigger.current || !box.current) return;
      const view = {
        width: document.documentElement.clientWidth || window.innerWidth,
        height: document.documentElement.clientHeight || window.innerHeight,
      };
      setAt(
        placeRef.current(trigger.current.getBoundingClientRect(), box.current.getBoundingClientRect(), view),
      );
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  return { open, setOpen, close, trigger, box, at } as {
    open: boolean;
    setOpen: (open: boolean) => void;
    close: (restoreFocus?: boolean) => void;
    trigger: RefObject<HTMLButtonElement | null>;
    box: RefObject<T | null>;
    at: { left: number; top: number } | null;
  };
}

/** Keeps Tab inside a modal box, and puts focus on its first control when it opens. */
export function trapTab(
  event: { key: string; shiftKey: boolean; preventDefault: () => void },
  root: HTMLElement | null,
) {
  if (event.key !== 'Tab' || !root) return;
  const focusable = [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/** The reading direction of the page: the boxes line up with their trigger's inline edge. */
export const isRtl = (): boolean => getComputedStyle(document.documentElement).direction === 'rtl';

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));
