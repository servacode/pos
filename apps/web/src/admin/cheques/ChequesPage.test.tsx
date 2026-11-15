import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Cheque, MeResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { addDays, chequeParts, dueSoon } from './ChequesPage';

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

describe('cashing a cheque before its day', () => {
  it('warns in the confirmation when the due day has not come, and not when it has', async () => {
    const items = [
      cheque({ sourceId: 'a', reference: 'LATER-1', dueDate: addDays(todayText(), 10) }),
      cheque({ sourceId: 'b', reference: 'PAST-1', dueDate: addDays(todayText(), -1) }),
    ];
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/cheques?status=pending': () => ({ status: 200, body: { items, baseCurrency: 'SYP' } }),
    });
    const { user } = renderApp('/cheques');
    const table = await screen.findByRole('table', { name: 'الشيكات' });
    const later = (await within(table).findByText('LATER-1')).closest('tr') as HTMLElement;
    await user.click(within(later).getByRole('button', { name: 'حُصّل' }));
    const sure = await screen.findByRole('dialog');
    expect(sure).toHaveTextContent('لم يأتِ بعد');
    await user.click(within(sure).getByRole('button', { name: 'تراجع' }));
    const past = within(table).getByText('PAST-1').closest('tr') as HTMLElement;
    await user.click(within(past).getByRole('button', { name: 'حُصّل' }));
    expect(await screen.findByRole('dialog')).not.toHaveTextContent('لم يأتِ بعد');
  });
});

describe('the cheques table on narrow screens', () => {
  it('keeps the amount and the actions on every width, and drops the bank and date columns until they fit', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/cheques?status=pending': () => ({
        status: 200,
        body: { items: [cheque()], baseCurrency: 'SYP' },
      }),
    });
    renderApp('/cheques');
    const table = await screen.findByRole('table', { name: 'الشيكات' });
    await within(table).findByText('CHQ-7781');
    const head = (name: string) => within(table).getByRole('columnheader', { name, hidden: true });
    expect(head('المبلغ').className).not.toContain('hidden');
    expect(head('إجراءات').className).not.toContain('hidden');
    expect(head('البنك').className).toContain('sm:table-cell');
    expect(head('التاريخ').className).toContain('2xl:table-cell');
    expect(head('الزبون').className).toContain('hidden sm:table-cell');
    expect(table.parentElement!.parentElement!.innerHTML).not.toContain('min-w-44');
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
    // The bank shows in its own column, and under the number where that column is left out
    expect(within(table).getAllByText('بنك سورية').length).toBeGreaterThan(0);
    expect(screen.getByText(/تستحق|يستحق/)).toBeInTheDocument();
    const refs = () =>
      within(table)
        .getAllByText(/^(FAR|NEAR|OUT)-1$/)
        .map((e) => e.textContent);
    expect(refs()).toEqual(['FAR-1', 'NEAR-1', 'OUT-1']);
    await user.click(screen.getByRole('radio', { name: 'تاريخ الاستحقاق' }));
    expect(refs()[0]).toBe('NEAR-1');
    const outRow = within(table).getByText('OUT-1').closest('tr') as HTMLElement;
    expect(within(outRow).getAllByText('مورد المواد').length).toBeGreaterThan(0);
    // a name wraps to two lines at most instead of widening the table past its box
    expect(
      within(outRow)
        .getAllByText('مورد المواد')
        .some((e) => e.classList.contains('line-clamp-2')),
    ).toBe(true);
    expect(within(outRow).getAllByText('بنك الشرق').length).toBeGreaterThan(0);
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
    // A supplier cheque left the bank on the day it was paid: a note, no action to take
    const left = await within(table).findByText('خُصم من البنك يوم الدفع');
    expect(left).toBeInTheDocument();
    // It wraps inside its cell instead of running off the table's edge
    expect(left).not.toHaveClass('whitespace-nowrap');
    const row = (await within(table).findByText('NEAR-1')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'مرتجع' }));
    const sure = await screen.findByRole('dialog');
    await user.click(within(sure).getByRole('button', { name: 'تراجع' }));
    expect(requestsTo('POST', '/v1/cheques/actions')).toHaveLength(0);
  });
  it('counts the customers cheques and the supplier cheques apart, so the header matches the amount card', async () => {
    const items = [
      cheque({ sourceId: 'a', reference: 'IN-1' }),
      cheque({ sourceId: 'b', reference: 'IN-2' }),
      cheque({
        sourceId: 'c',
        sourceType: 'supplier_payment',
        direction: 'out',
        reference: 'OUT-1',
        customerName: null,
        supplierName: 'مورد المواد',
      }),
    ];
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/cheques?status=pending': () => ({ status: 200, body: { items, baseCurrency: 'SYP' } }),
    });
    renderApp('/cheques');
    const customers = (await screen.findByText('شيكات الزبائن')).parentElement as HTMLElement;
    const suppliers = screen.getByText('شيكات صادرة للموردين').parentElement as HTMLElement;
    await waitFor(() => expect(customers).toHaveTextContent('2'));
    expect(suppliers).toHaveTextContent('1');
    expect(screen.queryByText('عدد الشيكات')).not.toBeInTheDocument();
  });
});

describe('a cheque typed as one line', () => {
  it('shows its number, bank and due day once each, apart', () => {
    expect(chequeParts({ reference: 'بنك سورية · CH-8001 · 2026-11-20', bank: null, dueDate: null })).toEqual(
      {
        number: 'CH-8001',
        bank: 'بنك سورية',
        due: '2026-11-20',
      },
    );
    // The structured fields win, and a number is not taken for the bank
    expect(chequeParts({ reference: 'CH-1', bank: 'بنك الشرق', dueDate: '2026-12-01' })).toEqual({
      number: 'CH-1',
      bank: 'بنك الشرق',
      due: '2026-12-01',
    });
    // The line the till writes («بنك · رقم · يوم») with the bank also structured: the number is still found
    expect(
      chequeParts({
        reference: 'بنك سورية · CH-9100 · 2026-12-01',
        bank: 'بنك سورية',
        dueDate: '2026-12-01',
      }),
    ).toEqual({ number: 'CH-9100', bank: 'بنك سورية', due: '2026-12-01' });
    // The structured number is read first, whatever the line says
    expect(
      chequeParts({ reference: 'بنك سورية', bank: 'بنك سورية', dueDate: null, number: '000123' }).number,
    ).toBe('000123');
    expect(chequeParts({ reference: null, bank: null, dueDate: null })).toEqual({
      number: null,
      bank: null,
      due: null,
    });
  });
});
