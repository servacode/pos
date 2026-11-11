import { useEffect, useSyncExternalStore } from 'react';

/**
 * The user's theme (هوية 4 › الوضع الداكن): light, dark, or the device's own setting. It lives on this
 * device (localStorage), so it survives a reload and a new sign-in here. The page root carries it as
 * data-theme="light" | "dark"; with no attribute the theme follows the device. apps/web/index.html
 * reads the same key before the first paint, so a dark choice never flashes light. A choice made in
 * one tab reaches the app's other tabs through the storage event, which is listened to while
 * something uses it: a ThemeToggle on the screen, or useThemeSync at the app's root.
 */
export type ThemePreference = 'light' | 'dark' | 'system';

/** The localStorage key, shared with the inline script of apps/web/index.html. */
export const THEME_STORAGE_KEY = 'serva.theme';

const listeners = new Set<() => void>();

/** This visit's choice when the browser refuses to store it (private mode, full storage). */
let unsaved: ThemePreference | null = null;

function isForced(value: unknown): value is 'light' | 'dark' {
  return value === 'light' || value === 'dark';
}

/** The stored choice; 'system' when there is none, it is unreadable, or storage is unavailable. */
export function readThemePreference(): ThemePreference {
  if (unsaved) return unsaved;
  try {
    const stored = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    return isForced(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/**
 * The media query of a theme-color meta: index.html has one per scheme, marked data-scheme. A forced
 * theme turns its own on and the other off; 'system' hands both back to the device's setting.
 */
function themeColorMedia(scheme: string | undefined, preference: ThemePreference): string {
  if (!isForced(preference)) return `(prefers-color-scheme: ${scheme})`;
  return scheme === preference ? 'all' : 'not all';
}

/** Writes the choice on the page root and on the browser bar's colour. */
function paint(preference: ThemePreference): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (isForced(preference)) root.dataset.theme = preference;
  else delete root.dataset.theme;
  for (const meta of root.ownerDocument.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"][data-scheme]',
  )) {
    meta.setAttribute('media', themeColorMedia(meta.dataset.scheme, preference));
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Applies a choice at once and keeps it on this device. 'system' removes both the attribute and the
 * stored value. Never throws: when storage refuses, the choice still holds for this visit.
 */
export function applyThemePreference(preference: ThemePreference): void {
  paint(preference);
  try {
    if (isForced(preference)) globalThis.localStorage?.setItem(THEME_STORAGE_KEY, preference);
    else globalThis.localStorage?.removeItem(THEME_STORAGE_KEY);
    unsaved = null;
  } catch {
    unsaved = preference;
  }
  emit();
}

/** Another tab changed the choice: follow it here too. */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
  paint(readThemePreference());
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

const serverSnapshot = (): ThemePreference => 'system';

/**
 * The theme choice and its setter: `const [theme, setTheme] = useThemePreference()`. Every component
 * using it re-renders on a change, in this tab and in the app's other tabs.
 */
export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const preference = useSyncExternalStore(subscribe, readThemePreference, serverSnapshot);
  return [preference, applyThemePreference];
}

/**
 * Keeps this tab's theme in step with the app's other tabs on every screen, those without a
 * ThemeToggle too (the cashier on /pos): a choice made elsewhere is painted here at once. Run it
 * once at the app's root. It re-renders nothing.
 */
export function useThemeSync(): void {
  useEffect(() => {
    // A listener of its own, so two users of this hook never unsubscribe each other.
    const listener = () => {};
    return subscribe(listener);
  }, []);
}
