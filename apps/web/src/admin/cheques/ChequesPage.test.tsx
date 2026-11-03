import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Cheque, MeResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'customers.view', 'customers.manage'] },
  };
}

const cheque = (over: Partial<Cheque> = {}): Cheque => ({
  sourceType: 'sale',
  sourceId: 's-1',
  paymentNo: 2,
  documentNumber: 'INV-001-002-0000041',
  date: '2026-11-01',
  customerId: 'c-1',
  customerName: 'مؤسسة الفرات',
  reference: 'CHQ-7781',
  amountMinor: 3_000_000,
  currency: 'SYP',
  status: 'pending',
  actionDate: null,
  note: null,
  ...over,
});

describe('«الشيكات»', () => {
  it('lists the cheques under collection with their total, and marks one cashed', async () => {
    let items = [cheque(), cheque({ sourceId: 's-2', reference: 'CHQ-9002', amountMinor: 1_000_000 })];
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/cheques?status=pending': () => ({
        status: 200,
        body: { items: items.filter((c) => c.status === 'pending'), baseCurrency: 'SYP' },
      }),
      'POST /v1/cheques/actions': (r: MockRequest) => {
        const body = r.body as { sourceId: string; action: 'cleared' | 'bounced'; date: string };
        items = items.map((c) =>
          c.sourceId === body.sourceId ? { ...c, status: body.action, actionDate: body.date } : c,
        );
        return { status: 200, body: items.find((c) => c.sourceId === body.sourceId) };
      },
    });
    const { user } = renderApp('/cheques');
    expect(await screen.findByRole('heading', { name: 'الشيكات', level: 1 })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'الشيكات' });
    expect(await within(table).findByText('CHQ-7781')).toBeInTheDocument();
    expect(document.body).toHaveTextContent('40,000');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
    const row = within(table).getByText('CHQ-7781').closest('tr')!;
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'حُصّل' }));
    expect(await within(table).findByText('CHQ-9002')).toBeInTheDocument();
    expect(within(table).queryByText('CHQ-7781')).not.toBeInTheDocument();
    expect(requestsTo('POST', '/v1/cheques/actions').at(-1)?.body).toMatchObject({
      sourceType: 'sale',
      sourceId: 's-1',
      paymentNo: 2,
      action: 'cleared',
    });
  });
});
