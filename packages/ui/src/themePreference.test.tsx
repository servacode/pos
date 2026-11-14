import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoonIcon, PanelCollapseIcon, PanelExpandIcon, SunIcon, SystemThemeIcon } from './icons';
import { renderUi } from './test/render';
import { ThemeToggle } from './ThemeToggle';
import {
  applyThemePreference,
  readThemePreference,
  THEME_STORAGE_KEY,
  useThemePreference,
  useThemeSync,
} from './themePreference';

const root = document.documentElement;

/** The two theme-color metas of apps/web/index.html. */
function addThemeColorMetas() {
  for (const scheme of ['light', 'dark']) {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('data-scheme', scheme);
    meta.setAttribute('media', `(prefers-color-scheme: ${scheme})`);
    document.head.append(meta);
  }
}

beforeEach(() => {
  localStorage.clear();
  delete root.dataset.theme;
});

afterEach(() => {
  vi.restoreAllMocks();
  applyThemePreference('system');
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
});

describe('theme preference', () => {
  it('follows the device until a choice is stored', () => {
    expect(THEME_STORAGE_KEY).toBe('serva.theme');
    expect(readThemePreference()).toBe('system');

    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readThemePreference()).toBe('dark');

    localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(readThemePreference()).toBe('system');
  });

  it('applies a choice on the page root and keeps it; «system» removes both', () => {
    applyThemePreference('dark');
    expect(root).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    applyThemePreference('light');
    expect(root).toHaveAttribute('data-theme', 'light');
    expect(readThemePreference()).toBe('light');

    applyThemePreference('system');
    expect(root).not.toHaveAttribute('data-theme');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('turns the browser bar colour of the chosen theme on, and hands both back for «system»', () => {
    addThemeColorMetas();
    const [light, dark] = [...document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];

    applyThemePreference('dark');
    expect(dark).toHaveAttribute('media', 'all');
    expect(light).toHaveAttribute('media', 'not all');

    applyThemePreference('system');
    expect(light).toHaveAttribute('media', '(prefers-color-scheme: light)');
    expect(dark).toHaveAttribute('media', '(prefers-color-scheme: dark)');
  });

  it('never throws when storage refuses, and keeps the choice for this visit', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(readThemePreference()).toBe('system');

    expect(() => applyThemePreference('dark')).not.toThrow();
    expect(root).toHaveAttribute('data-theme', 'dark');
    expect(readThemePreference()).toBe('dark');
  });

  it('keeps every user of the hook in step, in this tab and from another one', async () => {
    function Shown() {
      const [preference] = useThemePreference();
      return <p>{preference}</p>;
    }
    render(<Shown />);
    expect(screen.getByText('system')).toBeInTheDocument();

    act(() => applyThemePreference('light'));
    expect(screen.getByText('light')).toBeInTheDocument();

    // Another tab chose dark: the storage event arrives here.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));
    });
    await waitFor(() => expect(screen.getByText('dark')).toBeInTheDocument());
    expect(root).toHaveAttribute('data-theme', 'dark');
  });

  it('follows another tab on a screen with no theme switch once the app root syncs', () => {
    function CashierRoot() {
      useThemeSync();
      return <p>الكاشير</p>;
    }
    /** Another tab of the app stores a choice (null: «حسب الجهاز»); the storage event arrives here. */
    function otherTab(value: 'light' | 'dark' | null) {
      if (value === null) localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, value);
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: value }));
      });
    }
    addThemeColorMetas();
    const dark = document.head.querySelector('meta[name="theme-color"][data-scheme="dark"]');

    const { unmount } = render(<CashierRoot />);
    otherTab('dark');
    expect(root).toHaveAttribute('data-theme', 'dark');
    expect(dark).toHaveAttribute('media', 'all');

    otherTab(null);
    expect(root).not.toHaveAttribute('data-theme');
    expect(dark).toHaveAttribute('media', '(prefers-color-scheme: dark)');

    // Unmounted, it no longer listens.
    unmount();
    otherTab('light');
    expect(root).not.toHaveAttribute('data-theme');
  });
});

describe('ThemeToggle', () => {
  it('names itself «تبديل المظهر» and shows the current choice', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const { user } = renderUi(<ThemeToggle />);

    const button = screen.getByRole('button', { name: 'تبديل المظهر' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button.querySelector('svg')).toHaveClass('lucide-moon');

    await user.click(button);
    const menu = screen.getByRole('menu', { name: 'المظهر' });
    expect(menu).toBeInTheDocument();
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'فاتح',
      'داكن',
      'حسب الجهاز',
    ]);
    expect(screen.getByRole('menuitemradio', { name: 'داكن' })).toHaveAttribute('aria-checked', 'true');
  });

  it('switches the theme at once and keeps it on this device', async () => {
    const { user } = renderUi(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'تبديل المظهر' });
    expect(button.querySelector('svg')).toHaveClass('lucide-monitor');

    await user.click(button);
    await user.click(screen.getByRole('menuitemradio', { name: 'داكن' }));

    expect(root).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(button.querySelector('svg')).toHaveClass('lucide-moon');

    await user.click(button);
    await user.click(screen.getByRole('menuitemradio', { name: 'حسب الجهاز' }));
    expect(root).not.toHaveAttribute('data-theme');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('works from the keyboard and hints the current choice', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const { user } = renderUi(<ThemeToggle />);

    await user.tab();
    const button = screen.getByRole('button', { name: 'تبديل المظهر' });
    expect(button).toHaveAccessibleDescription('المظهر: فاتح');

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'فاتح' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(root).toHaveAttribute('data-theme', 'dark');
    expect(button).toHaveFocus();
  });
});

describe('theme and sidebar glyphs', () => {
  function svgOf(element: ReactElement): SVGSVGElement {
    const { container } = render(<div dir="rtl">{element}</div>);
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('No <svg> rendered');
    return svg;
  }

  it('draws the sun, the moon and the screen, never mirrored', () => {
    expect(svgOf(<SunIcon />)).toHaveClass('lucide-sun');
    expect(svgOf(<MoonIcon />)).toHaveClass('lucide-moon');
    expect(svgOf(<SystemThemeIcon />)).toHaveClass('lucide-monitor');
    expect(svgOf(<SunIcon />)).not.toHaveClass('rtl:-scale-x-100');
  });

  it('mirrors the sidebar fold glyphs in RTL, where the sidebar is on the right', () => {
    expect(svgOf(<PanelCollapseIcon />)).toHaveClass('lucide-panel-left-close', 'rtl:-scale-x-100');
    expect(svgOf(<PanelExpandIcon />)).toHaveClass('lucide-panel-left-open', 'rtl:-scale-x-100');
  });
});
