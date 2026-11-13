import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProductTexts, StockAlert } from '@serva/core';
import { catalogMe, ids, lookupRoutes, product } from '../../test/catalog';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { backInStockMessage } from './ShopTextSection';

const alert = (n: number, extra: Partial<StockAlert> = {}): StockAlert => ({
  id: `a-${n}`,
  variantId: ids.milkVariant,
  variantLabel: 'L · أبيض',
  phone: `+96394455566${n}`,
  createdAt: '2026-11-03T10:00:00.000Z',
  notifiedAt: null,
  inStock: true,
  ...extra,
});

function open(texts: ProductTexts, alerts: StockAlert[] = []) {
  let current = texts;
  let list = alerts;
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: catalogMe() },
    ...lookupRoutes,
    [`GET /v1/products/${ids.milk}`]: { status: 200, body: product() },
    [`GET /v1/products/${ids.milk}/images`]: { status: 200, body: { items: [] } },
    [`GET /v1/products/${ids.milk}/shop-text`]: () => ({ status: 200, body: current }),
    [`PUT /v1/products/${ids.milk}/shop-text`]: (r: MockRequest) => {
      const body = r.body as ProductTexts;
      if ((body.description ?? '').length > 3000) return apiError(400, 'validation_failed', 'الوصف طويل');
      current = body;
      return { status: 200, body: current };
    },
    [`GET /v1/products/${ids.milk}/stock-alerts`]: () => ({ status: 200, body: { items: list } }),
    'POST /v1/stock-alerts/a-1/notified': () => {
      list = list.map((a) => (a.id === 'a-1' ? { ...a, notifiedAt: '2026-11-04T10:00:00.000Z' } : a));
      return { status: 200, body: { id: 'a-1', notifiedAt: '2026-11-04T10:00:00.000Z' } };
    },
  });
  return { ...mock, ...renderApp(`/products/${ids.milk}`) };
}

describe('«وصف المتجر الإلكتروني» on the product page', () => {
  it('saves the description and the size guide on their own', async () => {
    const { requestsTo, user } = open({ description: null, sizeGuide: null });
    const section = await screen.findByRole('region', { name: 'وصف المتجر الإلكتروني' });
    const save = within(section).getByRole('button', { name: 'احفظ الوصف' });
    // Nothing typed: nothing to save
    expect(save).toBeDisabled();
    await user.type(await within(section).findByLabelText('الوصف'), 'حليب طازج');
    await user.type(within(section).getByLabelText('دليل المقاسات'), 'علبة 1 لتر');
    await user.click(save);
    expect(await within(section).findByText('حُفظ الوصف.')).toBeInTheDocument();
    expect(requestsTo('PUT', `/v1/products/${ids.milk}/shop-text`)[0]!.body).toEqual({
      description: 'حليب طازج',
      sizeGuide: 'علبة 1 لتر',
    });
    expect(save).toBeDisabled();
  });

  it('shows what is saved, and the server’s refusal', async () => {
    const { user } = open({ description: 'x'.repeat(3100), sizeGuide: 'M: 38' });
    const section = await screen.findByRole('region', { name: 'وصف المتجر الإلكتروني' });
    expect(await within(section).findByLabelText('دليل المقاسات')).toHaveValue('M: 38');
    await user.type(within(section).getByLabelText('الوصف'), 'y');
    await user.click(within(section).getByRole('button', { name: 'احفظ الوصف' }));
    expect(await within(section).findByText('الوصف طويل')).toBeInTheDocument();
  });

  it('lists the phones waiting for a piece, links WhatsApp with the message, and marks one told', async () => {
    const { requestsTo, user } = open({ description: null, sizeGuide: null }, [
      alert(1),
      alert(2, { notifiedAt: '2026-11-03T12:00:00.000Z', inStock: false }),
    ]);
    const list = await screen.findByRole('list', { name: 'زبائن ينتظرون التوفر' });
    const [first, second] = within(list).getAllByRole('listitem');
    expect(first).toHaveTextContent('+963944555661');
    expect(first).toHaveTextContent('توفرت');
    const wa = within(first!).getByRole('link', { name: /راسل/ });
    expect(wa).toHaveAttribute('target', '_blank');
    const href = wa.getAttribute('href')!;
    expect(href.startsWith('https://wa.me/963944555661?text=')).toBe(true);
    expect(decodeURIComponent(href)).toContain('توفّرت من جديد');
    expect(decodeURIComponent(href)).toContain('(L · أبيض)');
    expect(second).toHaveTextContent('أُبلغ');
    expect(within(second!).queryByRole('button', { name: 'تم إبلاغه' })).not.toBeInTheDocument();
    await user.click(within(first!).getByRole('button', { name: 'تم إبلاغه' }));
    expect(requestsTo('POST', '/v1/stock-alerts/a-1/notified')).toHaveLength(1);
    expect(await within(list).findAllByText('أُبلغ')).toHaveLength(2);
  });

  it('writes the WhatsApp message with the store, the product and the piece', () => {
    expect(backInStockMessage('نور', 'قميص', 'L')).toBe(
      'مرحباً، قميص (L) توفّرت من جديد في نور. هل تريد أن نحجزها لك؟',
    );
    expect(backInStockMessage('نور', 'قميص', null)).not.toContain('(');
  });
});
