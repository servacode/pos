import { screen, waitFor } from '@testing-library/react';
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
              lastPurchaseOn: '2026-11-03',
              purchasesTotalMinor: 1_200_000,
            },
            { id: 's-2', name: 'شركة الأمل', phone: null, notes: null, balanceMinor: 0, archived: false },
          ],
        },
      },
    });
    const { user } = renderApp('/suppliers');
    const link = (await screen.findAllByRole('link', { name: 'مستودع النور' }))[0]!;
    expect(link).toHaveAttribute('href', '/suppliers/s-1/statement');
    // The last purchase in numbers, the purchases total, and a button to add a supplier here
    expect(screen.getAllByText(/03\/11\/2026/).length).toBeGreaterThan(0);
    expect(screen.getByRole('columnheader', { name: 'مشترياتنا منه' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'مورد جديد' })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'من له مبلغ فقط' }));
    expect(screen.queryByText('شركة الأمل')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'صفحات المشتريات' })).toBeInTheDocument();
  });
});

describe('«الموردون»: edit and archive (round 44)', () => {
  it('edits a supplier, archives it, and shows the dollars owed apart', async () => {
    const me = makeMe();
    const supplier = {
      id: 's-1',
      name: 'مستودع النور',
      phone: '0944123456',
      notes: null,
      balanceMinor: 500_000,
      usdBalanceMinor: 1_200,
      usdBookMinor: 150_000,
      archived: false,
      lastPurchaseOn: '2026-11-03',
      purchasesTotalMinor: 1_200_000,
    };
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: { ...me, user: { ...me.user, permissions: ['purchases.manage'] } } },
      'GET /v1/suppliers': {
        status: 200,
        body: { baseCurrency: 'SYP', totalOwedMinor: 500_000, items: [supplier] },
      },
      'PUT /v1/suppliers/s-1': { status: 200, body: { ...supplier, name: 'النور للتجارة', archived: true } },
    });
    const { user } = renderApp('/suppliers');
    // The dollars owed sit under the pounds
    expect((await screen.findAllByText(/منه/)).length).toBeGreaterThan(0);
    await user.click(await screen.findByRole('button', { name: 'عدّل مستودع النور' }));
    const name = screen.getByLabelText('اسم المورد');
    await user.clear(name);
    await user.type(name, 'النور للتجارة');
    await user.click(screen.getByRole('switch', { name: 'أرشف هذا المورد' }));
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('أُرشف المورد النور للتجارة.')).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/suppliers/s-1')[0]?.body).toMatchObject({
      name: 'النور للتجارة',
      phone: '0944123456',
      archived: true,
    });
  });
});

describe('«الموردون»: رصيد افتتاحي (round 47)', () => {
  it('records the debt a supplier had before the system, once, with its own id', async () => {
    const me = makeMe();
    const supplier = {
      id: 's-1',
      name: 'مستودع النور',
      phone: null,
      notes: null,
      balanceMinor: 0,
      archived: false,
    };
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: { ...me, user: { ...me.user, permissions: ['purchases.manage'] } } },
      'GET /v1/suppliers': {
        status: 200,
        body: { baseCurrency: 'SYP', totalOwedMinor: 0, items: [supplier] },
      },
      'POST /v1/suppliers/s-1/opening-balance': {
        status: 201,
        body: { id: 'x', number: '2026-0000001', supplierId: 's-1', kind: 'debt', amountMinor: 250_000 },
      },
    });
    const { user } = renderApp('/suppliers');
    await user.click(await screen.findByRole('button', { name: 'عدّل مستودع النور' }));
    const record = screen.getByRole('button', { name: 'سجّل الرصيد الافتتاحي' });
    expect(record).toBeDisabled();
    await user.type(screen.getByLabelText('المبلغ بالليرة'), '2500');
    await user.click(record);
    expect(await screen.findByText('سُجّل الرصيد الافتتاحي للمورد مستودع النور.')).toBeInTheDocument();
    const body = requestsTo('POST', '/v1/suppliers/s-1/opening-balance')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ kind: 'debt', amountMinor: 250_000 });
    expect(typeof body.id).toBe('string');
  });

  it('adds the opening balance together with a new supplier', async () => {
    const me = makeMe();
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: { ...me, user: { ...me.user, permissions: ['purchases.manage'] } } },
      'GET /v1/suppliers': { status: 200, body: { baseCurrency: 'SYP', totalOwedMinor: 0, items: [] } },
      'POST /v1/suppliers': {
        status: 201,
        body: { id: 's-9', name: 'جديد', balanceMinor: 0, archived: false },
      },
      'POST /v1/suppliers/s-9/opening-balance': { status: 201, body: { id: 'x', number: '1' } },
    });
    const { user } = renderApp('/suppliers');
    await user.click(await screen.findByRole('button', { name: 'مورد جديد' }));
    await user.type(screen.getByLabelText('اسم المورد'), 'جديد');
    await user.click(screen.getByRole('radio', { name: 'له عندك دفعة مقدّمة' }));
    await user.type(screen.getByLabelText('المبلغ بالليرة'), '100');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    await waitFor(() => expect(requestsTo('POST', '/v1/suppliers/s-9/opening-balance')).toHaveLength(1));
    expect(requestsTo('POST', '/v1/suppliers/s-9/opening-balance')[0]?.body).toMatchObject({
      kind: 'credit',
      amountMinor: 10_000,
    });
  });
});
