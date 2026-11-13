import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ControlledRegisterResponse, MeResponse } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { isoDay } from '../../lib/dates';
import { rangeOf } from './ControlledRegisterPage';

const today = () => isoDay(Date.now(), makeMe().tenant.timezone);
const path = (from: string, to: string) => `/v1/pharmacy/controlled-register?from=${from}&to=${to}`;

function pharmacist(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    tenant: { ...base.tenant, sectors: ['pharmacy'] },
    settings: { ...base.settings },
    user: { ...base.user, permissions: [...base.user.permissions, 'pharmacy.controlled'] },
  };
}

const register = (matches: boolean): ControlledRegisterResponse => ({
  from: '2026-10-30',
  to: '2026-10-30',
  rows: [
    {
      date: '2026-10-30',
      variantId: 'v-1',
      item: 'ترامادول 50',
      batchNo: 'A-01',
      kind: 'sale',
      document: 'INV-001-002-0000007',
      prescriptionRef: 'RX-77',
      doctor: 'د. سامر',
      patientName: 'ليلى',
      patientId: '01020304',
      qtyIn: 0,
      qtyOut: 3000,
      balance: 7000,
    },
    {
      date: '2026-10-30',
      variantId: 'v-1',
      item: 'ترامادول 50',
      batchNo: null,
      kind: 'stocktake',
      document: null,
      prescriptionRef: null,
      doctor: null,
      patientName: null,
      patientId: null,
      qtyIn: 1000,
      qtyOut: 0,
      balance: 8000,
    },
  ],
  balances: [
    {
      variantId: 'v-1',
      item: 'ترامادول 50',
      registerQty: 8000,
      stockQty: matches ? 8000 : 6000,
      matches,
    },
  ],
  matches,
});

describe('«سجل الأدوية المراقبة»', () => {
  it('lists each movement with its prescription, patient and balance, and prints', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: pharmacist() }),
      [`GET ${path(today(), today())}`]: () => ({ status: 200, body: register(true) }),
    });
    const { user } = renderApp('/controlled-register');
    const table = await screen.findByRole('table', { name: 'حركات الأدوية المراقبة' });
    expect(await within(table).findByText('RX-77')).toBeInTheDocument();
    expect(table).toHaveTextContent('د. سامر');
    expect(table).toHaveTextContent('ليلى');
    expect(table).toHaveTextContent('01020304');
    expect(table).toHaveTextContent('جرد');
    expect(screen.queryByText(/رصيد السجل لا يطابق المخزون/)).toBeNull();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
    expect(requestsTo('GET', path(today(), today()))).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'اطبع' }));
    expect(print).toHaveBeenCalled();
    print.mockRestore();
  });

  it('warns when the register does not match the stock, and switches to a month', async () => {
    const month = rangeOf('month', today().slice(0, 7));
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: pharmacist() }),
      [`GET ${path(today(), today())}`]: () => ({ status: 200, body: register(false) }),
      [`GET ${path(month.from, month.to)}`]: () => ({ status: 200, body: register(false) }),
    });
    const { user } = renderApp('/controlled-register');
    expect(await screen.findByText(/رصيد السجل لا يطابق المخزون/)).toBeInTheDocument();
    expect(screen.getByText('غير مطابق')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'شهري' }));
    await screen.findByLabelText('الشهر');
    expect(requestsTo('GET', path(month.from, month.to))).toHaveLength(1);
  });

  it('computes the first and last day of a day and a month', () => {
    expect(rangeOf('day', '2026-10-30')).toEqual({ from: '2026-10-30', to: '2026-10-30' });
    expect(rangeOf('month', '2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(rangeOf('month', '2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(rangeOf('month', '2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});
