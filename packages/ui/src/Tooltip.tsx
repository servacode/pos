import { useDirection } from '@radix-ui/react-direction';
import {
  Children,
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type HTMLAttributes,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefCallback,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

// ── Floating boxes: the tooltip's and the menu's ────────────────────────────────────────────────

/** Where a floating box sits against its anchor, in the reading direction. */
export type FloatingSide = 'top' | 'bottom' | 'start' | 'end';
export type FloatingAlign = 'start' | 'center' | 'end';

type PhysicalSide = 'top' | 'bottom' | 'left' | 'right';

const OPPOSITE: Record<PhysicalSide, PhysicalSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

/** Floating boxes keep this far (px) from the window's edges. */
const EDGE = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Where (viewport px) a box of `size` goes next to `anchor`: on the asked side unless the other side
 * has more room, lined up in the reading direction (start is the right in Arabic), inside the window.
 */
export function placeFloating(
  anchor: DOMRect,
  size: { width: number; height: number },
  side: FloatingSide,
  align: FloatingAlign,
  dir: 'ltr' | 'rtl',
  gap: number,
): { x: number; y: number } {
  const viewWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewHeight = document.documentElement.clientHeight || window.innerHeight;
  const rtl = dir === 'rtl';
  let physical: PhysicalSide =
    side === 'start' ? (rtl ? 'right' : 'left') : side === 'end' ? (rtl ? 'left' : 'right') : side;
  const room: Record<PhysicalSide, number> = {
    top: anchor.top - gap - EDGE,
    bottom: viewHeight - anchor.bottom - gap - EDGE,
    left: anchor.left - gap - EDGE,
    right: viewWidth - anchor.right - gap - EDGE,
  };
  const vertical = physical === 'top' || physical === 'bottom';
  const needed = vertical ? size.height : size.width;
  if (room[physical] < needed && room[OPPOSITE[physical]] > room[physical]) physical = OPPOSITE[physical];

  let x: number;
  let y: number;
  if (physical === 'top' || physical === 'bottom') {
    y = physical === 'top' ? anchor.top - gap - size.height : anchor.bottom + gap;
    const atStart = rtl ? anchor.right - size.width : anchor.left;
    const atEnd = rtl ? anchor.left : anchor.right - size.width;
    x = align === 'start' ? atStart : align === 'end' ? atEnd : anchor.left + (anchor.width - size.width) / 2;
  } else {
    x = physical === 'left' ? anchor.left - gap - size.width : anchor.right + gap;
    y = anchor.top + (anchor.height - size.height) / 2;
  }
  return {
    x: clamp(x, EDGE, viewWidth - size.width - EDGE),
    y: clamp(y, EDGE, viewHeight - size.height - EDGE),
  };
}

/**
 * Keeps a floating box (classes `fixed start-0 top-0`) against its anchor while `active`: placed
 * before the first paint, then again on every scroll, resize and change of the box's size. The box
 * is moved by a translate from wherever it lands, so an ancestor that holds fixed boxes (the blurred
 * overlay of an open dialog) does not shift it.
 */
export function useAnchoredBox(
  active: boolean,
  anchor: RefObject<HTMLElement | null>,
  box: RefObject<HTMLElement | null>,
  { side, align, gap, dir }: { side: FloatingSide; align: FloatingAlign; gap: number; dir: 'ltr' | 'rtl' },
): void {
  useLayoutEffect(() => {
    if (!active) return;
    const update = () => {
      const anchorElement = anchor.current;
      const boxElement = box.current;
      if (!anchorElement || !boxElement) return;
      boxElement.style.transform = '';
      const landed = boxElement.getBoundingClientRect();
      const { x, y } = placeFloating(anchorElement.getBoundingClientRect(), landed, side, align, dir, gap);
      boxElement.style.transform = `translate(${Math.round(x - landed.left)}px, ${Math.round(y - landed.top)}px)`;
    };
    update();
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (box.current) resized?.observe(box.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      resized?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [active, anchor, box, side, align, gap, dir]);
}

/**
 * Where a floating box mounts: inside the open dialog or sheet that holds its anchor, so the
 * dialog's focus trap and its blocked outside do not cut it off; otherwise on the body.
 */
export function floatingRoot(anchor: HTMLElement | null): HTMLElement | null {
  if (!anchor) return null;
  return anchor.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? anchor.ownerDocument.body;
}

/** One ref from many (React 19: a callback ref may return its cleanup). */
export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (node) => {
    const cleanups = refs.map((ref) => {
      if (typeof ref === 'function') {
        const cleanup = ref(node);
        return typeof cleanup === 'function' ? cleanup : () => ref(null);
      }
      if (ref) {
        ref.current = node;
        return () => {
          ref.current = null;
        };
      }
      return undefined;
    });
    return () => {
      for (const cleanup of cleanups) cleanup?.();
    };
  };
}

type AnyProps = Record<string, unknown>;
type Handler = (...args: unknown[]) => void;

/**
 * Props for an element that another component decorates (a slot): the element's own props win,
 * except event handlers, which both run (the element's first), and classes, which add up.
 */
export function mergeSlotProps(slot: AnyProps, own: AnyProps): AnyProps {
  const merged: AnyProps = { ...slot, ...own };
  for (const key of Object.keys(slot)) {
    const slotValue = slot[key];
    const ownValue = own[key];
    if (/^on[A-Z]/.test(key) && typeof slotValue === 'function' && typeof ownValue === 'function') {
      merged[key] = (...args: unknown[]) => {
        (ownValue as Handler)(...args);
        (slotValue as Handler)(...args);
      };
    } else if (key === 'className' && typeof slotValue === 'string' && typeof ownValue === 'string') {
      merged[key] = cn(slotValue, ownValue);
    }
  }
  return merged;
}

// ── Tooltip ─────────────────────────────────────────────────────────────────────────────────────

/** How long the pointer rests on the control before its hint shows (هوية 4 › Tooltip). */
const SHOW_DELAY_MS = 300;
/** Time to move the pointer from the control onto its hint (WCAG 1.4.13: the hint can be hovered). */
const HIDE_DELAY_MS = 100;
/** A hint that closed this recently lets the next one show at once (moving along a toolbar). */
const SKIP_DELAY_MS = 300;

let lastHiddenAt = 0;

/** The keyboard put focus here (not a click or a tap). */
function focusedByKeyboard(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

/**
 * The control's own popup is open: a Menu's trigger (aria-haspopup) while its menu shows. The hint
 * would sit on the popup's first items and take the press meant for them. A control that only
 * expands in place (a sidebar fold button: aria-expanded, no popup) keeps its hint.
 */
function popupOpen(props: AnyProps): boolean {
  const popup = props['aria-haspopup'];
  const expanded = props['aria-expanded'];
  return (
    popup !== undefined && popup !== false && popup !== 'false' && (expanded === true || expanded === 'true')
  );
}

type SlotProps = Omit<HTMLAttributes<HTMLElement>, 'content' | 'children'> & { ref?: Ref<HTMLElement> };

export interface TooltipProps extends SlotProps {
  /** The hint: a few words. Never the only way to learn something. */
  content: ReactNode;
  /** The one control it describes: a button, an icon button, a link. */
  children: ReactElement;
  /** Its side of the control, in the reading direction; it flips when there is no room. Default top. */
  side?: FloatingSide;
  /** Milliseconds of hover before it shows (default 300). Keyboard focus shows it at once. */
  delay?: number;
}

/**
 * A short hint on a control (هوية 4 › Tooltip): after a rest of the pointer, or at once when the
 * keyboard reaches the control; gone on leave, blur, a press, or Esc (which closes only the hint),
 * and kept away while the control's own popup is open (a Menu's trigger). While shown, the control
 * is described by it (aria-describedby). Props the Tooltip gets from a component that decorates it
 * (a Menu's trigger) pass through to the control.
 *
 * `<Tooltip content="اطبع آخر فاتورة"><IconButton label="اطبع" icon={<PrintIcon />} /></Tooltip>`
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  delay = SHOW_DELAY_MS,
  ref: slotRef,
  ...slot
}: TooltipProps) {
  const id = useId();
  const dir = useDirection();
  const [open, setOpen] = useState(false);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const shown = useRef(false);
  /** A pointer is down on the control: the focus it brings is a click's or a tap's, not the keyboard's. */
  const pressed = useRef(false);
  const showTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);

  const setShown = useCallback((next: boolean) => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
    if (shown.current === next) return;
    shown.current = next;
    if (next) setRoot(floatingRoot(anchor.current));
    else lastHiddenAt = Date.now();
    setOpen(next);
  }, []);

  const showSoon = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    if (shown.current) return;
    window.clearTimeout(showTimer.current);
    const wait = Date.now() - lastHiddenAt < SKIP_DELAY_MS ? 0 : delay;
    showTimer.current = window.setTimeout(() => setShown(true), wait);
  }, [delay, setShown]);

  const hideSoon = useCallback(() => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShown(false), HIDE_DELAY_MS);
  }, [setShown]);

  useEffect(
    () => () => {
      window.clearTimeout(showTimer.current);
      window.clearTimeout(hideTimer.current);
    },
    [],
  );

  const child = Children.only(children) as ReactElement<SlotProps & { title?: string }>;
  const childProps = child.props;
  const hasContent = !(content === null || content === undefined || content === '' || content === false);
  // While the control's popup is open the hint waits; it shows again after, if the pointer still
  // rests on the control or the keyboard is back on it.
  const visible = open && hasContent && root !== null && !popupOpen({ ...slot, ...childProps });

  // Esc dismisses the hint and only the hint: a dialog around it stays open.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setShown(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [visible, setShown]);

  useAnchoredBox(visible, anchor, box, { side, align: 'center', gap: 6, dir });

  const childRef = childProps.ref;
  const ref = useMemo(() => mergeRefs(childRef, slotRef, anchor), [childRef, slotRef]);

  if (!hasContent) {
    const plain = mergeSlotProps(slot, childProps);
    plain.ref = ref;
    return cloneElement(child, plain);
  }

  const own: AnyProps = {
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') showSoon();
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') hideSoon();
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      pressed.current = true;
      event.currentTarget.ownerDocument.addEventListener(
        'pointerup',
        () => {
          pressed.current = false;
        },
        { once: true, capture: true },
      );
      setShown(false);
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (!pressed.current && focusedByKeyboard(event.currentTarget)) setShown(true);
    },
    onBlur: () => setShown(false),
  };
  const props = mergeSlotProps(mergeSlotProps(own, slot), childProps);
  props.ref = ref;
  props['aria-describedby'] =
    [childProps['aria-describedby'], slot['aria-describedby'], visible ? id : undefined]
      .filter(Boolean)
      .join(' ') || undefined;
  // The hint replaces the browser's own title bubble (an IconButton titles itself with its label).
  if (childProps.title === undefined) props.title = '';

  return (
    <>
      {cloneElement(child, props)}
      {visible
        ? createPortal(
            // Layer 50 (tab 14 › الطبقات, the toasts' layer): above dialogs (40), and above the toasts
            // and any menu already open, as it mounts after them; under the cashier's status bar (60).
            <div ref={box} dir={dir} className="fixed start-0 top-0 z-50">
              <div
                id={id}
                role="tooltip"
                onPointerEnter={() => window.clearTimeout(hideTimer.current)}
                onPointerLeave={hideSoon}
                className="max-w-64 rounded-small bg-ink px-2 py-1 text-xs font-semibold text-surface shadow-e2 motion-safe:animate-fade"
              >
                {content}
              </div>
            </div>,
            root,
          )
        : null}
    </>
  );
}
