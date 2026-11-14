import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Cheque, MeResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { addDays, dueSoon } from './ChequesPage';

const todayText = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(new Date());

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
    // One entry in the books: it waits for a confirmation
    const sure = await screen.findByRole('dialog');
    expect(requestsTo('POST', '/v1/cheques/actions')).toHaveLength(0);
    await user.click(within(sure).getByRole('button', { name: 'نعم، حُصّل' }));
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

describe('cheques by due date', () => {
  it('counts the pending ones falling due within 7 days, and none that are cashed, far or undated', () => {
    expect(addDays('2026-11-28', 7)).toBe('2026-12-05');
    const day = '2026-11-14';
    const items = [
      cheque({ dueDate: '2026-11-14' }),
      cheque({ dueDate: '2026-11-21' }),
      cheque({ dueDate: '2026-11-10' }),
      cheque({ dueDate: '2026-11-22' }),
      cheque({ dueDate: '2026-11-15', status: 'cleared' }),
      cheque({ dueDate: null }),
    ];
    expect(dueSoon(items, day).map((c) => c.dueDate)).toEqual(['2026-11-14', '2026-11-21', '2026-11-10']);
  });

  it('shows the bank and due day, sorts by due date, warns about the near ones and gives an outgoing cheque no buttons', async () => {
    const near = addDays(todayText(), 3);
    const far = addDays(todayText(), 60);
    const items = [
      cheque({ sourceId: 'a', reference: 'FAR-1', bank: 'بنك بيمو', dueDate: far }),
      cheque({ sourceId: 'b', reference: 'NEAR-1', bank: 'بنك سورية', dueDate: near }),
      cheque({
        sourceId: 'c',
        sourceType: 'supplier_payment',
        direction: 'out',
        reference: 'OUT-1',
        customerName: null,
        supplierName: 'مورد المواد',
        bank: 'بنك الشرق',
        dueDate: far,
      }),
    ];
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/cheques?status=pending': () => ({ status: 200, body: { items, baseCurrency: 'SYP' } }),
    });
    const { user } = renderApp('/cheques');
    const table = await screen.findByRole('table', { name: 'الشيكات' });
    expect(await within(table).findByText('NEAR-1')).toBeInTheDocument();
    expect(within(table).getByText('بنك سورية')).toBeInTheDocument();
    expect(screen.getByText(/تستحق|يستحق/)).toBeInTheDocument();
    const refs = () =>
      within(table)
        .getAllByText(/^(FAR|NEAR|OUT)-1$/)
        .map((e) => e.textContent);
    expect(refs()).toEqual(['FAR-1', 'NEAR-1', 'OUT-1']);
    await user.click(screen.getByRole('radio', { name: 'تاريخ الاستحقاق' }));
    expect(refs()[0]).toBe('NEAR-1');
    const outRow = within(table).getByText('OUT-1').closest('tr') as HTMLElement;
    expect(within(outRow).getByText('مورد المواد')).toBeInTheDocument();
    expect(within(outRow).queryByRole('button', { name: 'حُصّل' })).not.toBeInTheDocument();
  });
});

describe('cheque reminders', () => {
  it('reads a due day typed into the reference, and counts a supplier cheque only until its day', () => {
    const day = '2026-11-14';
    const out = { direction: 'out', sourceType: 'supplier_payment' } as const;
    const items = [
      cheque({ reference: 'CHQ-7781 2026-11-17', dueDate: null }),
      cheque({ reference: 'CHQ-1', dueDate: null }),
      cheque({ ...out, dueDate: '2026-11-20' }),
      cheque({ ...out, dueDate: '2026-11-12' }),
      cheque({ ...out, dueDate: '2026-12-30' }),
    ];
    expect(dueSoon(items, day).map((c) => c.reference)).toEqual(['CHQ-7781 2026-11-17']);
    expect(dueSoon(items, day, 'out').map((c) => c.dueDate)).toEqual(['2026-11-20']);
  });

  it('warns about a supplier cheque falling due, and asks before marking one bounced', async () => {
    const items = [
      cheque({ sourceId: 'a', reference: 'NEAR-1', dueDate: addDays(todayText(), 2) }),
      cheque({
        sourceId: 'c',
        sourceType: 'supplier_payment',
        direction: 'out',
        reference: 'OUT-1',
        customerName: null,
        supplierName: 'مورد المواد',
        dueDate: addDays(todayText(), 4),
      }),
    ];
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/cheques?status=pending': () => ({ status: 200, body: { items, baseCurrency: 'SYP' } }),
      'POST /v1/cheques/actions': () => ({ status: 200, body: items[0] }),
    });
    const { user } = renderApp('/cheques');
    expect(await screen.findByText(/شيك صادر للمورد يستحق/)).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'الشيكات' });
    const row = within(table).getByText('NEAR-1').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'مرتجع' }));
    const sure = await screen.findByRole('dialog');
    await user.click(within(sure).getByRole('button', { name: 'تراجع' }));
    expect(requestsTo('POST', '/v1/cheques/actions')).toHaveLength(0);
  });
});
