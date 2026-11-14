import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from './cn';

/**
 * Two small helpers for rows that scroll sideways on a phone: a strip of tabs or chips whose
 * hidden side fades, and the dots under a row of snapping cards.
 */

/** How much of each edge the fade covers */
const FADE = 28;

/**
 * A row that scrolls sideways (the page's tabs, a line of chips): the edge where more is hidden
 * fades out, so nobody takes the cut-off last item for the end; and the open item (the tab marked
 * `aria-current` or `aria-selected`) is brought into view when the strip appears. Without scrolling it is
 * only a wrapper.
 */
export function ScrollStrip({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Which physical edges have more behind them
  const [hidden, setHidden] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const room = el.scrollWidth - el.clientWidth;
    if (room <= 1) {
      setHidden((h) => (h.left || h.right ? { left: false, right: false } : h));
      return;
    }
    // scrollLeft is 0 at the start and grows (LTR) or shrinks below zero (RTL) towards the end
    const travelled = Math.abs(el.scrollLeft);
    const rtl =
      getComputedStyle(el).direction === 'rtl' || el.closest('[dir]')?.getAttribute('dir') === 'rtl';
    const moreAtStart = travelled > 1;
    const moreAtEnd = travelled < room - 1;
    const next = rtl ? { left: moreAtEnd, right: moreAtStart } : { left: moreAtStart, right: moreAtEnd };
    setHidden((h) => (h.left === next.left && h.right === next.right ? h : next));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelector<HTMLElement>('[aria-current="page"], [aria-selected="true"]')?.scrollIntoView?.({
      inline: 'center',
      block: 'nearest',
    });
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [measure]);

  const edge = (on: boolean) => (on ? 'transparent' : 'black');
  const mask: CSSProperties | undefined =
    hidden.left || hidden.right
      ? (() => {
          const value = `linear-gradient(to right, ${edge(hidden.left)} 0, black ${FADE}px, black calc(100% - ${FADE}px), ${edge(hidden.right)} 100%)`;
          return { maskImage: value, WebkitMaskImage: value };
        })()
      : undefined;

  return (
    <div
      ref={ref}
      data-fade-left={hidden.left || undefined}
      data-fade-right={hidden.right || undefined}
      style={mask}
      className={cn('scrollbar-none overflow-x-auto', className)}
    >
      {children}
    </div>
  );
}

/**
 * The dots under a row of snapping cards on a phone: one per card, the one in view marked, each a
 * button that brings its card in. They draw nothing when the cards all fit.
 */
export function SnapDots({
  scrollerRef,
  label = 'البطاقات',
  className,
}: {
  scrollerRef: RefObject<HTMLElement | null>;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState({ count: 0, index: 0 });

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      const cards = [...el.children] as HTMLElement[];
      if (el.scrollWidth <= el.clientWidth + 1 || cards.length < 2) {
        setState((s) => (s.count === 0 ? s : { count: 0, index: 0 }));
        return;
      }
      // The card whose middle is nearest the middle of the row is the one in view
      const rowBox = el.getBoundingClientRect();
      const middle = rowBox.left + rowBox.width / 2;
      let best = 0;
      let distance = Infinity;
      cards.forEach((card, i) => {
        const box = card.getBoundingClientRect();
        const d = Math.abs(box.left + box.width / 2 - middle);
        if (d < distance) {
          distance = d;
          best = i;
        }
      });
      setState((s) =>
        s.count === cards.length && s.index === best ? s : { count: cards.length, index: best },
      );
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [scrollerRef]);

  if (state.count < 2) return null;
  return (
    <div role="group" aria-label={label} className={cn('flex justify-center gap-1', className)}>
      {Array.from({ length: state.count }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`البطاقة ${i + 1} من ${state.count}`}
          aria-current={i === state.index ? 'true' : undefined}
          onClick={() =>
            (scrollerRef.current?.children[i] as HTMLElement | undefined)?.scrollIntoView?.({
              behavior: 'smooth',
              inline: 'center',
              block: 'nearest',
            })
          }
          className="group grid size-6 place-items-center rounded-full"
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-2 rounded-full transition-colors duration-120 ease-standard',
              i === state.index ? 'bg-brand' : 'bg-line-control/50 group-hover:bg-line-control',
            )}
          />
        </button>
      ))}
    </div>
  );
}

/**
 * A row of cards that scrolls and snaps on a phone, with its dots under it (and none where the cards
 * fit). `className` is the row's own: its scrolling, snapping and the breakpoint where it turns into a grid.
 */
export function SnapRow({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="flex flex-col gap-1">
      <div ref={ref} className={className}>
        {children}
      </div>
      <SnapDots scrollerRef={ref} label={label} />
    </div>
  );
}
