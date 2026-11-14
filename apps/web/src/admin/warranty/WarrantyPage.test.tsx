import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse, WarrantyClaim, WarrantyLookup } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';

function manager(sectors: MeResponse['tenant']['sectors'] = ['electronics']): MeResponse {
  const base = makeMe();
  return {
    ...base,
    tenant: { ...base.tenant, sectors },
    user: { ...base.user, permissions: [...base.user.permissions, 'catalog.manage'] },
  };
}

const claim = (over: Partial<WarrantyClaim> = {}): WarrantyClaim => ({
  id: 'c-1',
  number: 'WC-000001',
  status: 'received',
  serial: 'IMEI001',
  item: 'سامسونج A15',
  saleNumber: 'INV-001-002-0000004',
  soldOn: '2026-10-30',
  warrantyUntil: '2027-10-30',
  underWarranty: true,
  customerName: 'سامر الحلبي',
  customerPhone: '0944111222',
  issue: 'الشاشة لا تعمل',
  sentTo: null,
  costMinor: null,
  technician: null,
  loanItem: null,
  paidRepair: false,
  repairSaleNumber: null,
  events: [{ status: 'received', on: '2026-11-02', note: null }],
  createdAt: '2026-11-02T08:00:00.000Z',
  version: 1,
  ...over,
});

const lookup: WarrantyLookup = {
  serial: 'IMEI001',
  item: 'سامسونج A15',
  saleNumber: 'INV-001-002-0000004',
  soldOn: '2026-10-30',
  warrantyUntil: '2027-10-30',
  underWarranty: true,
  customerName: 'سامر الحلبي',
  customerPhone: '0944111222',
  claims: [],
};

describe('«الضمان والصيانة»', () => {
  it('looks a serial up, opens a claim on it, and lists it', async () => {
    const made = claim();
    let listed: WarrantyClaim[] = [];
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: manager() }),
      'GET /v1/warranty/claims?status=open': () => ({ status: 200, body: { items: listed } }),
      'GET /v1/warranty/lookup?serial=IMEI001': () => ({ status: 200, body: lookup }),
      'POST /v1/warranty/claims': (r: MockRequest) => {
        listed = [made];
        return { status: 201, body: { ...made, issue: (r.body as { issue: string }).issue } };
      },
    });
    const { user } = renderApp('/warranty');
    expect(await screen.findByText('لا مطالبات.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('الرقم التسلسلي أو IMEI'), 'IMEI001');
    await user.click(screen.getByRole('button', { name: 'ابحث' }));
    expect(await screen.findByText('تحت الكفالة')).toBeInTheDocument();
    expect(screen.getByText('سامر الحلبي')).toBeInTheDocument();
    expect(screen.getByText('2027-10-30')).toBeInTheDocument();

    const open = screen.getByRole('button', { name: 'افتح مطالبة' });
    expect(open).toBeDisabled();
    await user.type(screen.getByLabelText('العطل'), 'الشاشة لا تعمل');
    await user.click(open);

    const section = await screen.findByRole('region', { name: 'المطالبات' });
    expect(await within(section).findByText('WC-000001')).toBeInTheDocument();
    expect(within(section).getAllByText('مستلم').length).toBeGreaterThan(0);
    expect(requestsTo('POST', '/v1/warranty/claims').at(-1)?.body).toEqual({
      serial: 'IMEI001',
      issue: 'الشاشة لا تعمل',
    });
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('says so when the number is unknown', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: manager() }),
      'GET /v1/warranty/claims?status=open': () => ({ status: 200, body: { items: [] } }),
      'GET /v1/warranty/lookup?serial=NOPE999': () => ({
        status: 404,
        body: { error: { code: 'not_found', message: 'هذا الرقم التسلسلي غير موجود في المحل.' } },
      }),
    });
    const { user } = renderApp('/warranty');
    await user.type(await screen.findByLabelText('الرقم التسلسلي أو IMEI'), 'NOPE999');
    await user.click(screen.getByRole('button', { name: 'ابحث' }));
    expect(await screen.findByText('هذا الرقم التسلسلي غير موجود في المحل.')).toBeInTheDocument();
  });

  it('moves a claim to the supplier with where it went, then prints its slip', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const sent = claim({
      status: 'sent',
      sentTo: 'وكيل سامسونج',
      version: 2,
      events: [
        { status: 'received', on: '2026-11-02', note: null },
        { status: 'sent', on: '2026-11-03', note: null },
      ],
    });
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: manager() }),
      'GET /v1/warranty/claims?status=open': () => ({ status: 200, body: { items: [claim()] } }),
      'POST /v1/warranty/claims/c-1/status': () => ({ status: 200, body: sent }),
    });
    const { user } = renderApp('/warranty');
    await user.click(await screen.findByRole('button', { name: 'أُرسلت للمورد أو الصيانة' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('المورد أو الورشة'), 'وكيل سامسونج');
    await user.click(within(dialog).getByRole('button', { name: 'سجّل' }));
    expect(requestsTo('POST', '/v1/warranty/claims/c-1/status').at(-1)?.body).toEqual({
      status: 'sent',
      version: 1,
      sentTo: 'وكيل سامسونج',
    });

    await user.click(await screen.findByRole('button', { name: 'اطبع WC-000001' }));
    await vi.waitFor(() => expect(print).toHaveBeenCalled());
    expect(screen.getByText('مطالبة ضمان وصيانة')).toBeInTheDocument();
    print.mockRestore();
  });

  it('is for the store types that sell serial pieces only', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: manager(['clothing']) }),
    });
    renderApp('/warranty');
    expect(await screen.findByText('هذه الشاشة لا تخص نشاط محلّك')).toBeInTheDocument();
  });
});
