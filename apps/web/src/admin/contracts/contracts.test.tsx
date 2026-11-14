import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ContractPrice, DebtAgeingReport, MaintenanceContract, MeResponse, Rental } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { ageingCsv } from './DebtAgeingPage';

function manager(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    tenant: { ...base.tenant, sectors: ['medical_supplies'] },
    user: {
      ...base.user,
      permissions: [...base.user.permissions, 'catalog.manage', 'customers.view'],
    },
  };
}

const rental = (over: Partial<Rental> = {}): Rental => ({
  id: 'r-1',
  number: 'RNT-000001',
  status: 'out',
  overdue: false,
  serial: 'WC001',
  item: 'كرسي متحرك',
  customerId: null,
  customerName: 'مشفى الأمل',
  customerPhone: '0944555666',
  startDate: '2026-11-01',
  expectedReturn: '2026-11-08',
  rateUnit: 'week',
  rateMinor: 30_000,
  currency: 'SYP',
  depositMinor: 20_000,
  depositVoucher: 'GV-000001',
  note: null,
  returnedOn: null,
  chargeMinor: 30_000,
  version: 1,
  createdAt: '2026-11-01T08:00:00.000Z',
  ...over,
});

const contract = (over: Partial<MaintenanceContract> = {}): MaintenanceContract => ({
  id: 'm-1',
  number: 'MC-000001',
  customerId: null,
  customerName: 'عيادة النور',
  customerPhone: null,
  devices: [{ serial: 'OX-1', item: 'مكثف أكسجين' }],
  startDate: '2026-01-15',
  endDate: '2026-12-31',
  visitEveryMonths: 3,
  currency: 'SYP',
  priceMinor: 400_000,
  visits: [],
  nextVisit: '2026-11-15',
  visitOverdue: false,
  state: 'active',
  billedOn: null,
  note: null,
  version: 1,
  createdAt: '2026-01-10T08:00:00.000Z',
  ...over,
});

describe('«التأجير»', () => {
  it('lists the devices out with the late one marked, and prints a contract', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: manager() }),
      'GET /v1/rentals?status=out': () => ({
        status: 200,
        body: {
          items: [rental({ overdue: true }), rental({ id: 'r-2', number: 'RNT-000002', serial: 'WC002' })],
        },
      }),
    });
    const { user } = renderApp('/rentals');
    expect(await screen.findByText('RNT-000001')).toBeInTheDocument();
    expect(screen.getAllByText('متأخر')).toHaveLength(1);
    expect(screen.getAllByText('كرسي متحرك')).toHaveLength(2);
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: 'اطبع عقد RNT-000001' }));
    expect(await screen.findByRole('region', { name: 'عقد تأجير', hidden: true })).toBeInTheDocument();
    await vi.waitFor(() => expect(print).toHaveBeenCalled());
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('says so when nothing is out', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: manager() }),
      'GET /v1/rentals?status=out': () => ({ status: 200, body: { items: [] } }),
    });
    renderApp('/rentals');
    expect(await screen.findByText('لا أجهزة مؤجَّرة.')).toBeInTheDocument();
  });
});

describe('«عقود الصيانة»', () => {
  it('lists the upcoming visits, logs one, and renews an ending contract', async () => {
    let logged: unknown = null;
    let renewed = false;
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: manager() }),
      'GET /v1/maintenance?view=upcoming': () => ({
        status: 200,
        body: { items: [contract({ state: 'ending' })] },
      }),
      'POST /v1/maintenance/m-1/visits': (r: MockRequest) => {
        logged = r.body;
        return { status: 200, body: contract() };
      },
      'POST /v1/maintenance/m-1/renew': () => {
        renewed = true;
        return { status: 201, body: contract({ id: 'm-2', number: 'MC-000002' }) };
      },
    });
    const { user } = renderApp('/maintenance');
    expect(await screen.findByText('MC-000001')).toBeInTheDocument();
    expect(screen.getByText('يقترب انتهاؤه')).toBeInTheDocument();
    expect(screen.getByText('مكثف أكسجين')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'سجّل زيارة' }));
    await user.type(await screen.findByLabelText('الفني'), 'سامر');
    await user.click(screen.getByRole('button', { name: 'سجّل الزيارة' }));
    await vi.waitFor(() => expect(logged).toEqual({ technician: 'سامر', version: 1 }));

    await user.click(await screen.findByRole('button', { name: 'جدّد العقد' }));
    await vi.waitFor(() => expect(renewed).toBe(true));
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });
});

describe('«أسعار العقود»', () => {
  it('lists the prices of a type and a customer', async () => {
    const prices: ContractPrice[] = [
      {
        id: 'p-1',
        customerId: null,
        customerName: null,
        customerKind: 'hospital',
        variantId: 'v-1',
        item: 'كرسي متحرك',
        currency: 'SYP',
        priceMinor: 1_800_000,
        validFrom: '2026-01-01',
        validTo: null,
        note: null,
        version: 1,
      },
    ];
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: manager() }),
      'GET /v1/customers': () => ({
        status: 200,
        body: { items: [], totalOwedMinor: 0, baseCurrency: 'SYP' },
      }),
      'GET /v1/contract-prices': () => ({ status: 200, body: { items: prices } }),
    });
    renderApp('/contract-prices');
    expect(await screen.findByText('كرسي متحرك')).toBeInTheDocument();
    expect(screen.getByText(/نوع الزبون: مشفى/)).toBeInTheDocument();
  });
});

describe('«أعمار الديون»', () => {
  const report: DebtAgeingReport = {
    asOf: '2026-11-13',
    baseCurrency: 'SYP',
    items: [
      {
        customerId: 'c-1',
        name: 'زبون أ',
        phone: '0944111222',
        balanceMinor: 60_000,
        buckets: { d0_30: 30_000, d31_60: 30_000, d61_90: 0, d90_plus: 0 },
      },
    ],
    totals: { d0_30: 30_000, d31_60: 30_000, d61_90: 0, d90_plus: 0, balanceMinor: 60_000 },
  };

  it('shows each customer with the age of the debt and a totals row', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: manager() }),
      'GET /v1/reports/debt-ageing': () => ({ status: 200, body: report }),
    });
    renderApp('/reports/debt-ageing');
    expect(await screen.findByText('زبون أ')).toBeInTheDocument();
    expect(screen.getByText('0-30 يوماً')).toBeInTheDocument();
    expect(screen.getByText('أكثر من 90 يوماً')).toBeInTheDocument();
    expect(screen.getAllByText('الإجمالي').length).toBeGreaterThan(1);
  });

  it('exports one CSV row per customer and a totals row', () => {
    const csv = ageingCsv(report);
    expect(csv.headers).toEqual([
      'الزبون',
      'الجوال',
      '0-30 يوماً',
      '31-60 يوماً',
      '61-90 يوماً',
      'أكثر من 90 يوماً',
      'الإجمالي',
    ]);
    expect(csv.rows).toEqual([
      ['زبون أ', '0944111222', '300.00', '300.00', '0.00', '0.00', '600.00'],
      ['الإجمالي', '', '300.00', '300.00', '0.00', '0.00', '600.00'],
    ]);
  });
});
