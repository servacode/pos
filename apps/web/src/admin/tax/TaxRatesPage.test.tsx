import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaxRate } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { catalogMe, ids } from '../../test/catalog';
import { signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { bpOf } from './TaxRatesPage';

const rate = (over: Partial<TaxRate> = {}): TaxRate => ({
  id: ids.tax,
  name: 'رسم الاستهلاك',
  rateBp: 500,
  kind: 'consumption',
  showOnReceipt: true,
  archivedAt: null,
  version: 1,
  ...over,
});

const owner = () => catalogMe(['settings.manage', 'catalog.manage']);

afterEach(() => vi.unstubAllGlobals());

describe('bpOf', () => {
  it('reads a percentage as basis points, in either digits', () => {
    expect(bpOf('5')).toBe(500);
    expect(bpOf('7.5')).toBe(750);
    expect(bpOf('١٥٫٢٥%')).toBe(1525);
    expect(bpOf('100')).toBe(10_000);
  });

  it('refuses nothing, zero, over 100 and letters', () => {
    for (const bad of ['', '0', '101', 'abc', '1.234', '-5']) expect(bpOf(bad)).toBeNull();
  });
});

describe('«الضرائب»', () => {
  it('lists the rates with the default marked, and the shelf-price setting', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/tax-rates': {
        status: 200,
        body: {
          items: [rate(), rate({ id: 'r-2', name: 'طابع', rateBp: 100, kind: 'stamp', archivedAt: 'x' })],
          defaultRateBp: 500,
        },
      },
    });
    renderApp('/tax-rates');
    const table = await screen.findByRole('table', { name: 'نسب الضريبة' });
    expect(within(table).getByText('رسم الاستهلاك')).toBeInTheDocument();
    expect(within(table).getByText('الافتراضية')).toBeInTheDocument();
    expect(within(table).getByText('مؤرشفة')).toBeInTheDocument();
    expect(screen.getByText(/أسعار الرفوف عندك تشمل الضريبة/)).toBeInTheDocument();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('adds a rate with its percentage, kind and receipt flag', async () => {
    let items: TaxRate[] = [];
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/tax-rates': () => ({ status: 200, body: { items, defaultRateBp: 0 } }),
      'POST /v1/tax-rates': (r: MockRequest) => {
        items = [rate({ id: 'r-9', ...(r.body as object) } as Partial<TaxRate>)];
        return { status: 201, body: items[0] };
      },
    });
    const { user } = renderApp('/tax-rates');
    expect(await screen.findByText('لا ضرائب بعد')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ضريبة جديدة' }));
    const dialog = await screen.findByRole('dialog', { name: 'ضريبة جديدة' });

    // A wrong percentage is named, nothing is sent
    await user.type(within(dialog).getByLabelText('اسم الضريبة'), 'مبيعات 5%');
    await user.type(within(dialog).getByLabelText('النسبة بالمئة'), 'خمسة');
    await user.click(within(dialog).getByRole('button', { name: 'أضف الضريبة' }));
    expect(await within(dialog).findByText(/اكتب نسبة بين/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/tax-rates')).toHaveLength(0);

    await user.clear(within(dialog).getByLabelText('النسبة بالمئة'));
    await user.type(within(dialog).getByLabelText('النسبة بالمئة'), '5');
    await user.selectOptions(within(dialog).getByLabelText('نوع الضريبة'), 'sales');
    await user.click(within(dialog).getByRole('button', { name: 'أضف الضريبة' }));
    await waitFor(() => expect(requestsTo('POST', '/v1/tax-rates')).toHaveLength(1));
    expect(requestsTo('POST', '/v1/tax-rates')[0]!.body).toEqual({
      name: 'مبيعات 5%',
      rateBp: 500,
      kind: 'sales',
      showOnReceipt: true,
    });
    expect(await screen.findByText('مبيعات 5%')).toBeInTheDocument();
  });

  it('chooses the default, renames a rate without touching its percentage, and archives it', async () => {
    let list = [rate()];
    let defaultBp = 0;
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/tax-rates': () => ({ status: 200, body: { items: list, defaultRateBp: defaultBp } }),
      'PUT /v1/tax-rates/default': (r: MockRequest) => {
        defaultBp = (r.body as { taxRateId: string | null }).taxRateId ? 500 : 0;
        return { status: 200, body: { items: list, defaultRateBp: defaultBp } };
      },
      [`PATCH /v1/tax-rates/${ids.tax}`]: (r: MockRequest) => {
        const b = r.body as { name?: string; archived?: boolean };
        list = [rate({ name: b.name ?? 'رسم الاستهلاك', archivedAt: b.archived ? 'x' : null, version: 2 })];
        return { status: 200, body: list[0] };
      },
    });
    const { user } = renderApp('/tax-rates');
    await screen.findByRole('table', { name: 'نسب الضريبة' });

    await user.selectOptions(screen.getByLabelText('الضريبة الافتراضية للمنتج الجديد'), ids.tax);
    await waitFor(() => expect(requestsTo('PUT', '/v1/tax-rates/default')).toHaveLength(1));
    expect(requestsTo('PUT', '/v1/tax-rates/default')[0]!.body).toEqual({ taxRateId: ids.tax });
    expect(await screen.findByText('الافتراضية')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'عدّل' }));
    const dialog = await screen.findByRole('dialog', { name: 'تعديل الضريبة' });
    expect(within(dialog).queryByLabelText('النسبة بالمئة')).not.toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('اسم الضريبة'));
    await user.type(within(dialog).getByLabelText('اسم الضريبة'), 'رسم إنفاق');
    await user.click(within(dialog).getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('رسم إنفاق')).toBeInTheDocument();
    expect(requestsTo('PATCH', `/v1/tax-rates/${ids.tax}`)[0]!.body).toEqual({
      version: 1,
      name: 'رسم إنفاق',
      showOnReceipt: true,
    });

    await user.click(screen.getByRole('button', { name: 'أرشف' }));
    expect(await screen.findByText('مؤرشفة')).toBeInTheDocument();
  });

  it('shows the rates read-only to someone who may only read the catalog, and is closed to the rest', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: catalogMe(['catalog.manage']) }),
      'GET /v1/tax-rates': { status: 200, body: { items: [rate()], defaultRateBp: 0 } },
    });
    renderApp('/tax-rates');
    await screen.findByRole('table', { name: 'نسب الضريبة' });
    expect(screen.queryByRole('button', { name: 'ضريبة جديدة' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'عدّل' })).not.toBeInTheDocument();
    expect(screen.getByText('النسب يضيفها المالك ويعدّلها.')).toBeInTheDocument();
  });
});
