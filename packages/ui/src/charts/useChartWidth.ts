import { useLayoutEffect, useState } from 'react';

/** The width a chart assumes before it can measure (tests, a hidden tab): a card's usual width. */
export const FALLBACK_WIDTH = 640;

/**
 * The chart's own width in px, measured before the first paint and kept current by a
 * ResizeObserver, so marks are drawn 1:1 (crisp 2 px lines and gaps, round dots, real 4 px
 * corners) at any width, from a phone to a wide card.
 */
export function useChartWidth(): { ref: (node: HTMLElement | null) => void; width: number } {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => setWidth(Math.round(node.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { ref: setNode, width: width > 0 ? width : FALLBACK_WIDTH };
}
