/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '@serva/ui';
import { bannedWordsIn, userFacingText } from '../test/glossary';
import { renderApp } from '../test/renderApp';
import './UiGallery';

afterEach(() => {
  localStorage.removeItem(THEME_STORAGE_KEY);
  delete document.documentElement.dataset.theme;
});

const SECTIONS = [
  'الشعار',
  'الألوان',
  'الزوايا والظلال',
  'الخط',
  'الأيقونات',
  'الأزرار',
  'الحقول',
  'البطاقات والمؤشرات',
  'الجدول',
  'الشارات والتنبيهات',
  'التحميل والحالات الفارغة',
  'التبويبات وأداة التبديل',
  'النوافذ والقوائم والإشعارات',
  'الصورة الرمزية',
  'اختبار الاتجاه',
  'قطع الكاشير',
  'الهياكل',
];

/**
 * Every colour token of the theme (--color-…), once. Vitest empties CSS imports and the page's URL
 * resolves against the test origin here, so the file is read by its path on disk.
 */
const THEME_CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../packages/ui/src/theme.css'),
  'utf8',
);
const COLOUR_TOKENS = [
  ...new Set([...THEME_CSS.matchAll(/--color-([a-z0-9-]+):/g)].map((match) => match[1])),
];

/**
 * Opens the gallery and waits for it, with its toolbar. It is one big page, every component in its
 * states: its first render, cold and on a busy runner, can outlast the 5 s a screen gets
 * (vitest.setup.ts). Queries then look inside the toolbar or a section, not the whole page.
 */
async function openGallery(path = '/dev/ui') {
  const app = renderApp(path);
  const title = await screen.findByRole('heading', { name: 'معرض المكوّنات', level: 1 }, { timeout: 20_000 });
  return { ...app, toolbar: title.closest('header')! };
}

/** A section of the gallery, by its title. */
function section(title: string): HTMLElement {
  return screen.getByRole('region', { name: title });
}

describe('/dev/ui component gallery (dev builds only)', { timeout: 30_000 }, () => {
  it('shows every section with no server request, in the order the toolbar lists them', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { toolbar } = await openGallery();

    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual(SECTIONS);
    const list = within(toolbar).getByRole('navigation', { name: 'أقسام المعرض' });
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual(headings.map((heading) => [heading.textContent, `#${heading.closest('section')!.id}`]));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows a swatch of every colour token of the theme, by its name', async () => {
    await openGallery();

    const names = [...section('الألوان').querySelectorAll('code')].map((code) => code.textContent);
    expect(COLOUR_TOKENS).toEqual(
      expect.arrayContaining(['brand', 'surface-total', 'sidebar-brand', 'overlay']),
    );
    expect(names).toEqual(expect.arrayContaining(COLOUR_TOKENS));
  });

  it('switches the page root between light and dark, and keeps the choice on this device', async () => {
    const { user, toolbar } = await openGallery();

    const theme = within(toolbar).getByRole('radiogroup', { name: 'الوضع' });
    await user.click(within(theme).getByRole('radio', { name: 'داكن' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    await user.click(within(theme).getByRole('radio', { name: 'فاتح' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    await user.click(within(theme).getByRole('radio', { name: 'حسب الجهاز' }));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('shares one theme choice between its switch and the theme button', async () => {
    const { user, toolbar } = await openGallery();

    await user.click(
      within(section('النوافذ والقوائم والإشعارات')).getByRole('button', { name: 'تبديل المظهر' }),
    );
    await user.click(
      within(screen.getByRole('menu', { name: 'المظهر' })).getByRole('menuitemradio', { name: 'داكن' }),
    );

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    const theme = within(toolbar).getByRole('radiogroup', { name: 'الوضع' });
    expect(within(theme).getByRole('radio', { name: 'داكن' })).toBeChecked();
  });

  it('takes its starting theme, digits and density from the address', async () => {
    const { toolbar } = await openGallery('/dev/ui?theme=dark&digits=arab&density=touch');

    const digits = within(toolbar).getByRole('radiogroup', { name: 'الأرقام' });
    expect(within(digits).getByRole('radio', { name: '١٢٣' })).toBeChecked();
    const density = within(toolbar).getByRole('radiogroup', { name: 'الكثافة' });
    expect(within(density).getByRole('radio', { name: 'لمس' })).toBeChecked();
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('switches the digits of every amount', async () => {
    const { user, toolbar } = await openGallery();

    const digits = within(toolbar).getByRole('radiogroup', { name: 'الأرقام' });
    await user.click(within(digits).getByRole('radio', { name: '١٢٣' }));
    expect(within(section('الأزرار')).getByRole('button', { name: /ادفع.*١٣٬٤٢٠/ })).toBeInTheDocument();
  });

  it('opens the menus from their triggers and hints the icon buttons', async () => {
    const { user } = await openGallery();

    const overlays = section('النوافذ والقوائم والإشعارات');
    await user.click(within(overlays).getByRole('button', { name: 'إجراءات المنتج' }));
    const menu = screen.getByRole('menu', { name: 'إجراءات المنتج' });
    expect(within(menu).getByRole('menuitem', { name: 'احذف المنتج' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'أرشف الموديل' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(within(overlays).getByRole('button', { name: 'إجراءات المنتج' })).toHaveFocus();

    const print = within(overlays).getByRole('button', { name: 'اطبع الإيصال' });
    await user.hover(print);
    await waitFor(() => expect(print).toHaveAccessibleDescription('اطبع آخر فاتورة'));
  });

  it('uses no banned word outside the code names of the icons and tokens', async () => {
    await openGallery();

    const page = document.body.cloneNode(true) as HTMLElement;
    page.querySelectorAll('code').forEach((code) => code.remove());
    expect(bannedWordsIn(userFacingText(page))).toEqual([]);
  });
});
