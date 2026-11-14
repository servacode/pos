import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

describe('«التقارير»', () => {
  it('gathers the reports by question, with the sales reports apart from the books', async () => {
    const me = makeMe();
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': {
        status: 200,
        body: { ...me, user: { ...me.user, permissions: ['report.view'] } },
      },
    });
    renderApp('/reports');
    expect(await screen.findByRole('heading', { name: 'التقارير', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /من باع أكثر/ })).toHaveAttribute(
      'href',
      '/reports/sales?by=seller',
    );
    expect(screen.getByRole('region', { name: 'المبيعات' })).toBeInTheDocument();
    // A user with no books key sees no accounting group
    expect(screen.queryByRole('region', { name: 'المحاسبة والرقابة' })).not.toBeInTheDocument();
  });
});
