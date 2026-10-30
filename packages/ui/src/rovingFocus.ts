import type { KeyboardEvent } from 'react';

/**
 * Arrow-key movement for a row of options (tabs, segmented control). In RTL the next option is on
 * the left, so ArrowLeft moves forward; Home and End jump to the ends. Returns the new index, or
 * null when the key is not a movement key.
 */
export function nextIndex(
  event: KeyboardEvent,
  current: number,
  count: number,
  direction: 'ltr' | 'rtl',
): number | null {
  const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const backward = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
  switch (event.key) {
    case forward:
      return (current + 1) % count;
    case backward:
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
