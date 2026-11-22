import { useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';

/** The arrow that steps to the next mark: left where the first sits at the right (time in Arabic). */
export type ExploreForward = 'left' | 'right' | 'down';

export interface ExplorerOptions {
  /** How many marks (points, bars, parts) there are. */
  count: number;
  /** The mark under the pointer, from its viewport position and the explorer's box; null for none. */
  indexAt: (point: { x: number; y: number }, box: DOMRect) => number | null;
  forward: ExploreForward;
  /** Where the keyboard starts: the latest point of a time line, the first bar of a list. */
  start: number;
}

const NEXT: Record<ExploreForward, readonly string[]> = {
  left: ['ArrowLeft', 'ArrowUp'],
  right: ['ArrowRight', 'ArrowUp'],
  down: ['ArrowDown'],
};

const PREVIOUS: Record<ExploreForward, readonly string[]> = {
  left: ['ArrowRight', 'ArrowDown'],
  right: ['ArrowLeft', 'ArrowDown'],
  down: ['ArrowUp'],
};

/** The keyboard put focus here (not a click or a tap): only then does the readout open on focus. */
function focusedByKeyboard(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

export type ExplorerHandlers = {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};

/**
 * Which mark the reader is on (interaction › tooltips): the pointer finds the nearest one (the hit
 * target is the whole slot, never the painted pixels), a tap keeps it until the next tap elsewhere,
 * and the keyboard walks the marks with the arrows, Home and End, in the direction they are drawn.
 * Esc closes the readout.
 */
export function useExplorer({ count, indexAt, forward, start }: ExplorerOptions): {
  active: number | null;
  handlers: ExplorerHandlers;
} {
  const [active, setActive] = useState<number | null>(null);
  const pressed = useRef(false);
  const keyboard = useRef(false);
  const last = count - 1;
  const clamp = (index: number) => Math.max(0, Math.min(last, index));

  const point = (event: PointerEvent<HTMLElement>) => {
    if (count === 0) return;
    const index = indexAt(
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
    );
    setActive(index === null ? null : clamp(index));
  };

  const handlers: ExplorerHandlers = {
    onPointerDown: (event) => {
      pressed.current = true;
      const doc = event.currentTarget.ownerDocument;
      const release = () => {
        pressed.current = false;
        doc.removeEventListener('pointerup', release, true);
        doc.removeEventListener('pointercancel', release, true);
      };
      doc.addEventListener('pointerup', release, true);
      doc.addEventListener('pointercancel', release, true);
      keyboard.current = false;
      point(event);
    },
    onPointerMove: (event) => {
      if (event.pointerType === 'touch' && !pressed.current) return;
      keyboard.current = false;
      point(event);
    },
    onPointerLeave: (event) => {
      // A finger lifts before it leaves: the readout stays until a tap elsewhere takes the focus.
      if (event.pointerType === 'touch' || keyboard.current) return;
      setActive(null);
    },
    onFocus: (event) => {
      if (count === 0 || pressed.current || !focusedByKeyboard(event.currentTarget)) return;
      keyboard.current = true;
      setActive((current) => current ?? clamp(start));
    },
    onBlur: () => {
      keyboard.current = false;
      setActive(null);
    },
    onKeyDown: (event) => {
      if (count === 0) return;
      const current = active ?? clamp(start);
      let next: number;
      if (NEXT[forward].includes(event.key)) next = current + 1;
      else if (PREVIOUS[forward].includes(event.key)) next = current - 1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = last;
      else if (event.key === 'Escape' && active !== null) {
        setActive(null);
        return;
      } else return;
      event.preventDefault();
      keyboard.current = true;
      setActive(clamp(next));
    },
  };

  return { active: active === null || count === 0 ? null : clamp(active), handlers };
}
