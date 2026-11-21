import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ExpiryResponse, ExpiryRow, MeResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { recallAnswer } from '../reports/useReport';

function owner(): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'purchases.manage'] } };
}

const row = (over: Partial<ExpiryRow>): ExpiryRow => ({
  variantId: 'v-1',
  name: 'بانادول 500',
  branchId: 'br-1',
  branchName: 'الفرع الرئيسي',
  batchNo: 'A-01',
  expiryDate: '2026-10-25',
  purchaseNumber: 'PUR-0001',
  supplierId: 'sup-1',
  supplierName: 'مستودع الشفاء',
  receivedOn: '2026-10-20',
  qty: 10_000,
  daysLeft: -5,
  blocked: false,
  blockReason: null,
  ...over,
});

const report = (days: number): ExpiryResponse => ({
  today: '2026-10-30',
  items:
    days >= 90
      ? [
          row({}),
          row({
            variantId: 'v-2',
            name: 'أموكسيل 250',
            batchNo: null,
            expiryDate: '2026-11-15',
            purchaseNumber: 'PUR-0002',
            qty: 3_000,
            daysLeft: 16,
          }),
        ]
      : [],
});

const server = (extra: Record<string, (r: MockRequest) => { status: number; body: unknown }> = {}) =>
  mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': () => ({ status: 200, body: owner() }),
    'GET /v1/inventory/expiry?days=3650&unbatched=1': () => ({ status: 200, body: report(90) }),
    'GET /v1/inventory/expiry?days=30': () => ({ status: 200, body: report(30) }),
    ...extra,
  });

/** The batch's actions menu, opened on its first row, and one of its items chosen */
async function chooseMore(user: ReturnType<typeof renderApp>['user'], table: HTMLElement, item: string) {
  await user.click((await within(table).findAllByRole('button', { name: /إجراءات دفعة/ }))[0]!);
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

describe('«الصلاحية» on a phone and the recall button', () => {
  it('shows each batch as a card with its action in view, dates in Arabic, and a red recall only for the urgent', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      server({
        'GET /v1/inventory/expiry?days=3650&unbatched=1': () => ({
          status: 200,
          body: {
            today: '2026-10-30',
            items: [
              row({}),
              row({
                variantId: 'v-3',
                name: 'شاش معقم',
                batchNo: 'B-77',
                expiryDate: '2029-01-01',
                daysLeft: 800,
              }),
            ],
          },
        }),
      });
      renderApp('/expiry');
      const cards = await screen.findByRole('list', { name: 'الدفعات حسب الصلاحية' });
      expect(screen.queryByRole('table', { name: 'الدفعات حسب الصلاحية' })).not.toBeInTheDocument();
      expect(cards).not.toHaveTextContent('2026-10-25');
      expect(cards).toHaveTextContent('25/10/2026');
      const urgent = within(cards).getByRole('link', { name: /استدعاء الدفعة A-01/ });
      const calm = within(cards).getByRole('link', { name: /استدعاء الدفعة B-77/ });
      expect(urgent).toHaveClass('ix-urgent');
      expect(calm).not.toHaveClass('ix-urgent');
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('«الصلاحية»', () => {
  it('keeps the last answer, so the next visit opens with it instead of a blank skeleton', async () => {
    server();
    renderApp('/expiry');
    await screen.findByRole('table', { name: 'الدفعات حسب الصلاحية' });
    expect(recallAnswer<ExpiryResponse>('expiry|3650')?.items).toHaveLength(2);
  });

  it('lists the batches by expiry with what is really left, and narrows the window', async () => {
    const { requestsTo } = server();
    const { user } = renderApp('/expiry');
    const table = await screen.findByRole('table', { name: 'الدفعات حسب الصلاحية' });
    expect(await within(table).findByText('بانادول 500')).toBeInTheDocument();
    expect(table).toHaveTextContent('منتهٍ منذ 5 أيام');
    expect(table).toHaveTextContent('باقٍ 16 يوماً');
    // A red «استدعاء» on a batch row opens the recall page with its number
    const recall = within(table).getAllByRole('link', { name: /^استدعاء الدفعة/ })[0]!;
    expect(recall.getAttribute('href')).toContain('/recall?batch=');
    expect(table).toHaveTextContent('مستودع الشفاء');
    expect(table).toHaveTextContent('الفرع الرئيسي');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
    expect(requestsTo('GET', '/v1/inventory/expiry?days=3650&unbatched=1')).toHaveLength(1);
    await user.click(screen.getByRole('radio', { name: '30 يوماً' }));
    expect(await screen.findByText(/لا شيء ينتهي في هذه المدة/)).toBeInTheDocument();
    expect(requestsTo('GET', '/v1/inventory/expiry?days=30')).toHaveLength(1);
  });

  it('writes a batch off through the count, with the batch on the line', async () => {
    const { requestsTo } = server({
      'POST /v1/stocktakes': () => ({ status: 201, body: { id: 's-1', number: 'STK-1', lines: [] } }),
    });
    const { user } = renderApp('/expiry');
    const table = await screen.findByRole('table', { name: 'الدفعات حسب الصلاحية' });
    await chooseMore(user, table, 'أتلف الدفعة');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'أتلف الدفعة' }));
    expect(await screen.findByText(/أُتلفت الدفعة A-01/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/stocktakes').at(-1)?.body).toMatchObject({
      branchId: 'br-1',
      note: 'هدر',
      lines: [{ variantId: 'v-1', countedQty: 0, batchNo: 'A-01', expiryDate: '2026-10-25' }],
    });
  });

  it('counts a batch, and sends it back to its supplier with the batch named', async () => {
    const { requestsTo } = server({
      'POST /v1/stocktakes': () => ({ status: 201, body: { id: 's-1', number: 'STK-1', lines: [] } }),
      'POST /v1/supplier-returns': () => ({ status: 201, body: { id: 'r-1', number: 'PRT-1' } }),
    });
    const { user } = renderApp('/expiry');
    const table = await screen.findByRole('table', { name: 'الدفعات حسب الصلاحية' });
    await chooseMore(user, table, 'عدّ');
    let dialog = await screen.findByRole('dialog');
    const counted = within(dialog).getByLabelText('الكمية التي عددتها');
    await user.clear(counted);
    await user.type(counted, '8');
    await user.click(within(dialog).getByRole('button', { name: 'عدّ الدفعة' }));
    await screen.findByText(/سُجّل عدّ الدفعة A-01/);
    expect(requestsTo('POST', '/v1/stocktakes').at(-1)?.body).toMatchObject({
      lines: [{ variantId: 'v-1', countedQty: 8000, batchNo: 'A-01', expiryDate: '2026-10-25' }],
    });

    await chooseMore(user, table, 'أرجع للمورد');
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'أرجع للمورد' }));
    await screen.findByText(/أُرجعت الدفعة A-01 .* إلى مستودع الشفاء/);
    expect(requestsTo('POST', '/v1/supplier-returns').at(-1)?.body).toMatchObject({
      supplierId: 'sup-1',
      refund: 'credit',
      lines: [{ variantId: 'v-1', qty: 10_000, batchNo: 'A-01', expiryDate: '2026-10-25' }],
    });
  });

  it('blocks a batch for every till, and lifts the block', async () => {
    const { requestsTo } = server({
      'POST /v1/batches/block': () => ({ status: 200, body: { count: 1 } }),
    });
    const { user } = renderApp('/expiry');
    const table = await screen.findByRole('table', { name: 'الدفعات حسب الصلاحية' });
    await chooseMore(user, table, 'أوقف البيع');
    // Blocking waits for a confirmation
    const sure = await screen.findByRole('dialog');
    expect(requestsTo('POST', '/v1/batches/block')).toHaveLength(0);
    await user.click(within(sure).getByRole('button', { name: 'أوقف البيع' }));
    expect(await screen.findByText(/أُوقف بيع الدفعة A-01 في كل الفروع/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/batches/block').at(-1)?.body).toEqual({
      batchNo: 'A-01',
      variantId: 'v-1',
    });
  });

  it('shows a blocked batch with the way to lift it, and says why a failed action failed', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/inventory/expiry?days=3650&unbatched=1': () => ({
        status: 200,
        body: {
          today: '2026-10-30',
          items: [row({ blocked: true, blockReason: 'سحب', supplierId: null, supplierName: null })],
        },
      }),
      'POST /v1/batches/unblock': () => ({ status: 200, body: { count: 1 } }),
    });
    const { user } = renderApp('/expiry');
    const table = await screen.findByRole('table', { name: 'الدفعات حسب الصلاحية' });
    expect(await within(table).findByText('موقوفة')).toBeInTheDocument();
    await chooseMore(user, table, 'ارفع الإيقاف');
    expect(await screen.findByText(/رُفع الإيقاف عن الدفعة A-01/)).toBeInTheDocument();
    // No supplier is known for it, so it cannot be sent back from here
    await chooseMore(user, table, 'أرجع للمورد');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'أرجع للمورد' }));
    expect(await within(dialog).findByText(/لا مورد معروف لهذه الدفعة/)).toBeInTheDocument();
  });
  it('lists the «بلا دفعة» row (below zero) so the batches add up to the stock, with no actions on it', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/inventory/expiry?days=3650&unbatched=1': () => ({
        status: 200,
        body: {
          today: '2026-10-30',
          items: [
            row({ qty: 29_000, daysLeft: 20 }),
            row({ batchNo: null, expiryDate: null, daysLeft: null, qty: -20_000, purchaseNumber: null }),
          ],
        },
      }),
    });
    renderApp('/expiry');
    const table = await screen.findByRole('table', { name: 'الدفعات حسب الصلاحية' });
    expect(await within(table).findByText('بلا دفعة')).toBeInTheDocument();
    expect(within(table).getByText('سالب')).toBeInTheDocument();
    expect(screen.getByText(/فمجموع كل الصفوف يساوي المخزون/)).toBeInTheDocument();
    // only the real batch has an actions menu
    expect(within(table).getAllByRole('button', { name: /إجراءات دفعة/ })).toHaveLength(1);
  });
});
