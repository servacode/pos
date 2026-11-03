/**
 * Registers /sw.js (src/sw/worker.js) so the app opens without a network (tab 15). Only in a
 * production build, where the worker exists, and only where the browser allows workers (https or
 * localhost). A failure is logged and changes nothing: the app works online without it.
 */
export function registerServiceWorker(
  nav: Pick<Navigator, 'serviceWorker'> | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator,
  production: boolean = import.meta.env.PROD,
): void {
  if (!production || !nav || !('serviceWorker' in nav) || !nav.serviceWorker) return;
  const register = () => {
    nav.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
      console.warn('Service worker not registered:', error);
    });
  };
  if (typeof document !== 'undefined' && document.readyState !== 'complete') {
    window.addEventListener('load', register, { once: true });
  } else register();
}
