import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BulkPriceResult } from '@serva/core';
import { catalogMe } from '../../test/catalog';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { percentOf } from './BulkPricesPage';

const items = (applied: boolean): BulkPriceResult => ({
  applied,
  items: [
    {
      productId: 'p-1',
      variantId: 'v-1',
      name: 'قميص M',
      currency: 'SYP',
      oldMinor: 4_500_000,
      newMinor: 3_150_000,
    },
    {
      productId: 'p-1',
      variantId: 'v-2',
      name: 'قميص L',
      currency: 'SYP',
      oldMinor: 4_600_000,
      newMinor: 3_200_000,
    },
  ],
});

describe('«تغيير الأسعار»', () => {
  it('shows 30% off a category rounded to 500, applies it, and offers the new labels', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: catalogMe() },
      'GET /v1/categories': {
        status: 200,
        body: {
          items: [
            { id: 'c-men', name: 'رجالي', parentId: null, sortOrder: 0, productCount: 0, archivedAt: null },
            {
              id: 'c-shirts',
              name: 'قمصان',
              parentId: 'c-men',
              sortOrder: 0,
              productCount: 1,
              archivedAt: null,
            },
          ],
        },
      },
      'POST /v1/prices/bulk': (r: MockRequest) => ({
        status: 200,
        body: items((r.body as { apply: boolean }).apply),
      }),
    });
    const { user } = renderApp('/prices');
    await screen.findByRole('option', { name: 'رجالي › قمصان' });
    await user.selectOptions(screen.getByLabelText('التصنيف'), 'رجالي › قمصان');
    await user.click(screen.getByRole('button', { name: 'اعرض الأسعار الجديدة' }));
    const table = await screen.findByRole('table', { name: 'ما سيتغيّر' });
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('31,500');
    expect(requestsTo('POST', '/v1/prices/bulk')[0]!.body).toEqual({
      categoryId: 'c-shirts',
      percentBp: -3000,
      roundToMinor: 50_000,
      apply: false,
    });
    await user.click(screen.getByRole('button', { name: 'طبّق على 2 قطعة' }));
    expect(await screen.findByRole('link', { name: 'اطبع ملصقات الأسعار الجديدة' })).toHaveAttribute(
      'href',
      '/labels?products=p-1',
    );
    expect(requestsTo('POST', '/v1/prices/bulk')[1]!.body).toMatchObject({ apply: true });
  });

  it('reads a percent as typed, and refuses zero or too much', () => {
    expect(percentOf('-30')).toBe(-3000);
    expect(percentOf('−٢٥٪')).toBe(-2500);
    expect(percentOf('12.5')).toBe(1250);
    expect(percentOf('0')).toBeNull();
    expect(percentOf('-95')).toBeNull();
    expect(percentOf('abc')).toBeNull();
  });
});
