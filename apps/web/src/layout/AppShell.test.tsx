import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockFetch } from '../test/fetchMock';
import { makeMe, signedInRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';

function signedIn() {
  mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: makeMe() },
  });
  return renderApp('/');
}

describe('AppShell', () => {
  it('lists only screens that exist, with no «قريباً» items', async () => {
    signedIn();

    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['الرئيسية', 'الأجهزة']);
    expect(within(nav).getByRole('link', { name: 'الرئيسية' })).toHaveAttribute('aria-current', 'page');
    expect(document.body).not.toHaveTextContent('قريباً');
  });

  it('gives every link and button a 48 px touch target', async () => {
    signedIn();

    const nav = await screen.findByRole('navigation', { name: 'القائمة الرئيسية' });
    const targets = [
      ...within(nav).getAllByRole('link'),
      screen.getByRole('link', { name: 'سيرفا، الرئيسية' }),
      screen.getByRole('button', { name: /خروج/ }),
    ];
    for (const target of targets) expect(target).toHaveClass('min-h-12');
  });
});
