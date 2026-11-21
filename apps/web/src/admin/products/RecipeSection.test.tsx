import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Recipe } from '@serva/core';
import { catalogMe, ids, lookupRoutes, product } from '../../test/catalog';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { thousandths } from './RecipeSection';

const FLOUR = '00000000-0000-4000-8000-0000000000f1';

function open(initial: Recipe) {
  let current = initial;
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: catalogMe() },
    ...lookupRoutes,
    [`GET /v1/products/${ids.milk}`]: { status: 200, body: product() },
    [`GET /v1/products/${ids.milk}/images`]: { status: 200, body: { items: [] } },
    [`GET /v1/products/${ids.milk}/shop-text`]: { status: 200, body: { description: null, sizeGuide: null } },
    [`GET /v1/products/${ids.milk}/stock-alerts`]: { status: 200, body: { items: [] } },
    [`GET /v1/recipes/${ids.milk}`]: () => ({ status: 200, body: current }),
    [`PUT /v1/recipes/${ids.milk}`]: (r: MockRequest) => {
      const items = (r.body as { items: { variantId: string; qty: number }[] }).items;
      current = {
        productId: ids.milk,
        items: items.map((i) => ({
          variantId: i.variantId,
          name: 'طحين',
          unitSymbol: null,
          qty: i.qty,
          costMinor: 5_000,
        })),
        costMinor: 5_000 * items.length,
        incomplete: false,
      };
      return { status: 200, body: current };
    },
  });
  return { ...mock, ...renderApp(`/products/${ids.milk}`) };
}

const empty: Recipe = { productId: ids.milk, items: [], costMinor: 0, incomplete: false };

describe('«الوصفة» on the product page', () => {
  it('reads thousandths from what is typed', () => {
    expect(thousandths('0.2')).toBe(200);
    expect(thousandths('1,5')).toBe(1500);
    expect(thousandths('0')).toBeNull();
    expect(thousandths('abc')).toBeNull();
  });

  it('shows the saved ingredients with their cost, and saves a changed quantity', async () => {
    const { requestsTo, user } = open({
      productId: ids.milk,
      items: [{ variantId: FLOUR, name: 'طحين', unitSymbol: 'كغ', qty: 200, costMinor: 5_000 }],
      costMinor: 5_000,
      incomplete: true,
    });
    const section = await screen.findByRole('region', { name: 'الوصفة وكلفة الوجبة' });
    const qty = await within(section).findByLabelText('كمية طحين (كغ)');
    expect(qty).toHaveValue('0.2');
    expect(within(section).getByText(/ناقصة/)).toBeInTheDocument();
    await user.clear(qty);
    await user.type(qty, '0.35');
    await user.click(within(section).getByRole('button', { name: 'احفظ الوصفة' }));
    expect(await within(section).findByText('حُفظت الوصفة.')).toBeInTheDocument();
    expect(requestsTo('PUT', `/v1/recipes/${ids.milk}`)[0]!.body).toEqual({
      items: [{ variantId: FLOUR, qty: 350 }],
    });
  });

  it('refuses a missing quantity before asking the server, and removes an ingredient', async () => {
    const { requestsTo, user } = open({
      productId: ids.milk,
      items: [{ variantId: FLOUR, name: 'طحين', unitSymbol: null, qty: 200, costMinor: 5_000 }],
      costMinor: 5_000,
      incomplete: false,
    });
    const section = await screen.findByRole('region', { name: 'الوصفة وكلفة الوجبة' });
    const qty = await within(section).findByLabelText('كمية طحين');
    await user.clear(qty);
    await user.click(within(section).getByRole('button', { name: 'احفظ الوصفة' }));
    expect(await within(section).findByText('اكتب كمية كل مكوّن بأكثر من صفر.')).toBeInTheDocument();
    expect(requestsTo('PUT', `/v1/recipes/${ids.milk}`)).toHaveLength(0);
    await user.click(within(section).getByRole('button', { name: 'احذف طحين' }));
    await user.click(within(section).getByRole('button', { name: 'احفظ الوصفة' }));
    expect(requestsTo('PUT', `/v1/recipes/${ids.milk}`)[0]!.body).toEqual({ items: [] });
  });

  it('says there is no recipe yet', async () => {
    open(empty);
    const section = await screen.findByRole('region', { name: 'الوصفة وكلفة الوجبة' });
    expect(await within(section).findByText('لا وصفة لهذه الوجبة بعد.')).toBeInTheDocument();
  });
});
