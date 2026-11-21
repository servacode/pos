import { useEffect, useState, type RefObject } from 'react';
import { useThemePreference } from '@serva/ui';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function deviceIsDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
}

/**
 * Which of the two approved looks the page wears: «a» (فخم داكن) or «b» (فخم فاتح). It follows the
 * app's own theme choice (the header's ThemeToggle, localStorage serva.theme) and, with no choice,
 * the device.
 */
export function useLandingLook(): 'a' | 'b' {
  const [preference] = useThemePreference();
  const [dark, setDark] = useState(deviceIsDark);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(DARK_QUERY);
    const sync = () => setDark(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return preference === 'dark' || (preference === 'system' && dark) ? 'a' : 'b';
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Fades in every `.rv` block of the page as it scrolls into view (at once when motion is reduced). */
export function useReveal(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const blocks = [...(root.current?.querySelectorAll('.rv') ?? [])];
    if (typeof IntersectionObserver !== 'function' || reducedMotion()) {
      for (const block of blocks) block.classList.add('in');
      return;
    }
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('in');
          seen.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    for (const block of blocks) seen.observe(block);
    return () => seen.disconnect();
  }, [root]);
}

/** Smooth scrolling to the page's anchors, only while the landing is open and motion is allowed. */
export function useSmoothAnchors(): void {
  useEffect(() => {
    if (reducedMotion()) return;
    const html = document.documentElement;
    html.style.scrollBehavior = 'smooth';
    return () => {
      html.style.scrollBehavior = '';
    };
  }, []);
}
