import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bannedWordsIn, userFacingText } from '../test/glossary';
import { renderApp } from '../test/renderApp';
import './UiGallery';

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe('/dev/ui component gallery (dev builds only)', () => {
  it('shows every section with no server request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderApp('/dev/ui');

    expect(await screen.findByRole('heading', { name: 'معرض المكوّنات', level: 1 })).toBeInTheDocument();
    for (const section of [
      'الشعار',
      'الأيقونات',
      'الأزرار',
      'الحقول',
      'الجدول والتبويبات',
      'قطع الكاشير',
      'الهياكل',
    ]) {
      expect(screen.getByRole('heading', { name: section, level: 2 })).toBeInTheDocument();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('switches the page root between light and dark', async () => {
    const { user } = renderApp('/dev/ui');

    const theme = await screen.findByRole('radiogroup', { name: 'الوضع' });
    await user.click(within(theme).getByRole('radio', { name: 'داكن' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await user.click(within(theme).getByRole('radio', { name: 'فاتح' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    await user.click(within(theme).getByRole('radio', { name: 'حسب الجهاز' }));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('switches the digits of every amount', async () => {
    const { user } = renderApp('/dev/ui');

    await user.click(
      within(await screen.findByRole('radiogroup', { name: 'الأرقام' })).getByRole('radio', { name: '١٢٣' }),
    );
    expect(screen.getByRole('button', { name: /ادفع.*١٬٢٨٤٬٥٠٠/ })).toBeInTheDocument();
  });

  it('uses no banned word outside the code names of the icons', async () => {
    renderApp('/dev/ui');
    await screen.findByRole('heading', { name: 'معرض المكوّنات', level: 1 });
    const page = document.body.cloneNode(true) as HTMLElement;
    page.querySelectorAll('code').forEach((code) => code.remove());
    expect(bannedWordsIn(userFacingText(page))).toEqual([]);
  });
});
