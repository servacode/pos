import { useEffect } from 'react';

export const UNSAVED_TEXT = 'لديك تعديلات لم تُحفظ بعد. هل تغادر الصفحة وتخسرها؟';

/**
 * While `active`, leaving the page asks first: a reload or a closed tab (the browser's own prompt) and
 * a click on any link of the app (the menu, the breadcrumb). The router here is not a data router, so
 * the link click is caught on the page.
 */
export function useUnsavedGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!link || link.getAttribute('target') === '_blank' || link.hasAttribute('download')) return;
      const href = link.getAttribute('href') ?? '';
      if (!href.startsWith('/') && !href.startsWith('#')) return;
      if (href.startsWith('#') || href === window.location.pathname) return;
      if (!window.confirm(UNSAVED_TEXT)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // Browser Back/Forward: one extra entry for this very page sits in front, so the first Back lands
    // on it (the page stays) and asks; «stay» puts the entry back, «leave» goes one further back.
    const here = window.location.href;
    window.history.pushState(window.history.state, '', here);
    let leaving = false;
    const onPop = () => {
      if (leaving) return;
      if (window.confirm(UNSAVED_TEXT)) {
        leaving = true;
        window.history.back();
      } else {
        window.history.pushState(window.history.state, '', here);
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('popstate', onPop);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('click', onClick, true);
    };
  }, [active]);
}
