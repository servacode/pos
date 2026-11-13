import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PriceChange } from '@serva/core';
import { catalogMe } from '../../test/catalog';
import { mockFetch } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { HISTORY_HEADERS, historyRows, SOURCE_TEXT, whenText } from './PriceHistoryPage';

const row = (n: number, extra: Partial<PriceChange> = {}): PriceChange => ({
  id: `r-${n}`,
  at: '2026-11-03T10:30:00.000Z',
  userName: 'أحمد الخطيب',
  source: 'product_edit',
  productId: 'p-1',
  productName: 'قميص كتان',
  variantLabel: 'L',
  currency: 'SYP',
  oldMinor: 460_000,
  newMinor: 500_000,
  note: null,
  ...extra,
});

describe('«سجل تغيير الأسعار»', () => {
  it('lists who changed what, when, from-to and from where, and filters by day and product', async () => {
    const { requestsTo, fetchMock } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: catalogMe() },
      'GET /v1/price-history?limit=500': {
        status: 200,
        body: {
          items: [
            row(1),
            row(2, {
              source: 'price_list',
              productName: 'بنطال',
              oldMinor: 700_000,
              newMinor: 650_000,
              note: 'خريف.xlsx',
            }),
            row(3, {
              source: 'bulk',
              productId: null,
              productName: null,
              variantLabel: null,
              currency: null,
              oldMinor: null,
              newMinor: null,
              note: 'تعديل جماعي -30٪ على 12 قطعة',
            }),
          ],
        },
      },
      'GET /v1/price-history?from=2026-11-01&limit=500': { status: 200, body: { items: [row(1)] } },
    });
    const { user } = renderApp('/price-history');
    const table = await screen.findByRole('table', { name: 'تغييرات الأسعار' });
    await within(table).findAllByText('أحمد الخطيب');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('أحمد الخطيب');
    expect(rows[0]).toHaveTextContent('قميص كتان');
    expect(rows[0]).toHaveTextContent('4,600');
    expect(rows[0]).toHaveTextContent('5,000');
    expect(rows[0]).toHaveTextContent('صفحة المنتج');
    expect(rows[1]).toHaveTextContent('تحديث من ملف');
    // A bulk change is one row with its count, and no old and new price
    expect(rows[2]).toHaveTextContent('تعديل جماعي -30٪ على 12 قطعة');
    expect(within(rows[2]!).getAllByText('—')).toHaveLength(2);

    await user.type(screen.getByLabelText('من تاريخ'), '2026-11-01');
    await vi.waitFor(() =>
      expect(requestsTo('GET', '/v1/price-history?from=2026-11-01&limit=500')).toHaveLength(1),
    );
    await vi.waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalled();
  });

  it('says there is nothing yet', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: catalogMe() },
      'GET /v1/price-history?limit=500': { status: 200, body: { items: [] } },
    });
    renderApp('/price-history');
    expect(await screen.findByText('لا تغييرات في الأسعار هنا.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'صدّر CSV' })).toBeDisabled();
  });

  it('exports the rows on screen as a CSV in whole units', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: catalogMe() },
      'GET /v1/price-history?limit=500': { status: 200, body: { items: [row(1)] } },
    });
    const created: Blob[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        return 'blob:x';
      },
      revokeObjectURL: () => undefined,
    });
    const { user } = renderApp('/price-history');
    await screen.findByRole('table', { name: 'تغييرات الأسعار' });
    await user.click(screen.getByRole('button', { name: 'صدّر CSV' }));
    expect(created).toHaveLength(1);
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(created[0]!);
    });
    expect(text).toContain(HISTORY_HEADERS.join(','));
    expect(text).toContain('قميص كتان');
    expect(text).toContain(',4600,5000,');
    vi.unstubAllGlobals();
  });

  it('turns rows into CSV cells: units of the currency, blank for a summary', () => {
    expect(
      historyRows([row(1, { currency: 'USD', oldMinor: 1500, newMinor: 1800 })])[0]!.slice(5, 8),
    ).toEqual(['USD', 15, 18]);
    expect(
      historyRows([
        row(2, { source: 'bulk', currency: null, oldMinor: null, newMinor: null, note: 'ن' }),
      ])[0]!.slice(5, 9),
    ).toEqual(['', '', '', 'ن']);
    expect(Object.keys(SOURCE_TEXT)).toHaveLength(4);
    expect(whenText('2026-11-03T10:30:00.000Z')).toMatch(/^2026-11-03 \d{2}:\d{2}$/);
  });
});
