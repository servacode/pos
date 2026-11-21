import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CountSheet, MeResponse, StocktakeDetail } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

/** Round 38, #29: the stocktake on the phone: a sheet, scans, a local draft, one post with its own id */

const sheet: CountSheet = {
  branchId: 'b-1',
  categoryId: null,
  at: '2026-11-19T08:00:00.000Z',
  categories: [],
  items: [
    {
      variantId: 'v-1',
      name: 'حليب 1 لتر',
      categoryId: null,
      allowsFraction: false,
      qty: 10_000,
      barcodes: [{ code: '6281000000011', packQty: 1000 }],
    },
    {
      variantId: 'v-2',
      name: 'رز 5 كغ',
      categoryId: null,
      allowsFraction: false,
      qty: 4000,
      barcodes: [{ code: '6281000000028', packQty: 1000 }],
    },
  ],
};

const done: StocktakeDetail = {
  id: 'ignored',
  number: 'STK-2026-000009',
  date: '2026-11-19',
  branchId: 'b-1',
  lines: [],
  diffValueMinor: -40_000,
  baseCurrency: 'SYP',
};

function owner(): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'inventory.adjust'] } };
}

const baseRoutes = {
  'POST /v1/auth/refresh': signedInRefresh,
  'GET /v1/me': () => ({ status: 200, body: owner() }),
  'GET /v1/categories': () => ({ status: 200, body: { items: [] } }),
};

beforeEach(() => {
  localStorage.removeItem('serva.count.draft');
  localStorage.removeItem('serva.count.sheet');
});

describe('«الجرد بالهاتف»', () => {
  it('downloads the sheet, counts by scan, and posts one stocktake with the draft’s own id', async () => {
    const { requestsTo } = mockFetch({
      ...baseRoutes,
      'GET /v1/inventory/count-sheet': () => ({ status: 200, body: sheet }),
      'POST /v1/stocktakes': () => ({ status: 201, body: done }),
    });
    const { user } = renderApp('/inventory/count');
    await user.click(await screen.findByRole('button', { name: 'حمّل قائمة الجرد' }));
    const box = await screen.findByLabelText('باركود أو اسم صنف');
    // Two scans of the milk and one of the rice
    await user.type(box, '6281000000011{Enter}');
    await user.type(box, '6281000000011{Enter}');
    await user.type(box, '6281000000028{Enter}');
    expect(await screen.findByText(/رز 5 كغ/, { selector: 'b' })).toBeInTheDocument();
    // The draft is kept on the phone at once
    expect(JSON.parse(localStorage.getItem('serva.count.draft')!).counts).toEqual({
      'v-1': 2000,
      'v-2': 1000,
    });

    await user.click(screen.getByRole('button', { name: 'راجع وأرسل' }));
    const diffs = await screen.findByRole('list', { name: 'الفروق' });
    expect(within(diffs).getAllByRole('listitem')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'أرسل الجرد' }));
    expect(await screen.findByText(/سُجّل الجرد STK-2026-000009/)).toBeInTheDocument();

    const posted = requestsTo('POST', '/v1/stocktakes').at(-1)!.body as {
      id: string;
      lines: { variantId: string; countedQty: number }[];
    };
    expect(posted.id).toMatch(/^[0-9a-f-]{36}$/);
    // A partial count: only what was counted
    expect(posted.lines).toEqual(
      expect.arrayContaining([
        { variantId: 'v-1', countedQty: 2000 },
        { variantId: 'v-2', countedQty: 1000 },
      ]),
    );
    expect(posted.lines).toHaveLength(2);
    // Sent: nothing is left on the phone
    expect(localStorage.getItem('serva.count.draft')).toBeNull();
  });

  it('the last-scanned note follows a figure typed by hand', async () => {
    mockFetch({ ...baseRoutes, 'GET /v1/inventory/count-sheet': () => ({ status: 200, body: sheet }) });
    const { user } = renderApp('/inventory/count');
    await user.click(await screen.findByRole('button', { name: 'حمّل قائمة الجرد' }));
    await user.type(await screen.findByLabelText('باركود أو اسم صنف'), '6281000000011{Enter}');
    const note = await screen.findByText('حليب 1 لتر', { selector: 'b' });
    expect(note.closest('p')).toHaveTextContent('1');
    const field = await screen.findByLabelText('المعدود');
    await user.clear(field);
    await user.type(field, '7');
    await user.tab();
    await waitFor(() =>
      expect(screen.getByText('حليب 1 لتر', { selector: 'b' }).closest('p')).toHaveTextContent('7'),
    );
  });

  it('a barcode that is not in the sheet is said so and counts nothing', async () => {
    mockFetch({ ...baseRoutes, 'GET /v1/inventory/count-sheet': () => ({ status: 200, body: sheet }) });
    const { user } = renderApp('/inventory/count');
    await user.click(await screen.findByRole('button', { name: 'حمّل قائمة الجرد' }));
    await user.type(await screen.findByLabelText('باركود أو اسم صنف'), '9999999999999{Enter}');
    expect(await screen.findByText(/ليس في قائمة الجرد هذه/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('serva.count.draft')!).counts).toEqual({});
  });

  it('resumes the draft after a reload, and offline it queues the send until the connection returns', async () => {
    let attempts = 0;
    const { requestsTo } = mockFetch({
      ...baseRoutes,
      'GET /v1/inventory/count-sheet': () => ({ status: 200, body: sheet }),
      'POST /v1/stocktakes': (_r: MockRequest) => {
        attempts += 1;
        return { status: 201, body: done };
      },
    });
    // A draft already on the phone, with one counted item
    localStorage.setItem(
      'serva.count.draft',
      JSON.stringify({
        id: '0192a000-0000-7000-8000-00000000d001',
        branchId: 'b-1',
        categoryId: null,
        sheetAt: sheet.at,
        counts: { 'v-1': 7000 },
        queued: false,
        restZero: false,
      }),
    );
    localStorage.setItem('serva.count.sheet', JSON.stringify(sheet));
    const { user } = renderApp('/inventory/count');
    // No download: the sheet is already on the phone
    expect(await screen.findByLabelText('باركود أو اسم صنف')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'حمّل قائمة الجرد' })).not.toBeInTheDocument();
    expect(requestsTo('GET', '/v1/inventory/count-sheet')).toHaveLength(0);
    expect(screen.getByLabelText('المعدود')).toHaveValue('7');

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    await user.click(screen.getByRole('button', { name: 'راجع وأرسل' }));
    await user.click(await screen.findByRole('button', { name: 'أرسل عند عودة الاتصال' }));
    expect(attempts).toBe(0);
    expect(JSON.parse(localStorage.getItem('serva.count.draft')!).queued).toBe(true);

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(attempts).toBe(1));
    expect(await screen.findByText(/سُجّل الجرد/)).toBeInTheDocument();
    expect((requestsTo('POST', '/v1/stocktakes')[0]!.body as { id: string }).id).toBe(
      '0192a000-0000-7000-8000-00000000d001',
    );
  });
});
