import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

describe('«الموردون»', () => {
  it('lists suppliers with what is owed and links each to the statement', async () => {
    const me = makeMe();
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: { ...me, user: { ...me.user, permissions: ['purchases.manage'] } } },
      'GET /v1/suppliers': {
        status: 200,
        body: {
          baseCurrency: 'SYP',
          totalOwedMinor: 500_000,
          items: [
            {
              id: 's-1',
              name: 'مستودع النور',
              phone: '0944',
              notes: null,
              balanceMinor: 500_000,
              archived: false,
            },
            { id: 's-2', name: 'شركة الأمل', phone: null, notes: null, balanceMinor: 0, archived: false },
          ],
        },
      },
    });
    const { user } = renderApp('/suppliers');
    const link = (await screen.findAllByRole('link', { name: 'مستودع النور' }))[0]!;
    expect(link).toHaveAttribute('href', '/suppliers/s-1/statement');
    await user.click(screen.getByRole('checkbox', { name: 'من له مبلغ فقط' }));
    expect(screen.queryByText('شركة الأمل')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'صفحات المشتريات' })).toBeInTheDocument();
  });
});
