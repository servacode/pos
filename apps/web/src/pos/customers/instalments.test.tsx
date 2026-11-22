import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerInstalments } from '@serva/core/contracts/installments';
import type { ReceiptPayload } from '@serva/core/contracts/documents';
import { validateDocumentPayload } from '@serva/core/contracts/documents';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, posSets, staffServer } from '../../test/pos';
import { openShift, renderPos } from '../../test/renderPos';
import { allocationsFor } from './InstalmentPick';

/** Taking a customer's payment toward an instalment: the pick, the next instalment, the allocations. */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const PLAN = '0192a3b4-c5d6-7e8f-9a0b-0000000000aa';
const plans = (today = '2026-10-30'): CustomerInstalments => ({
  today,
  plans: [
    {
      id: PLAN,
      number: 'INV-001-002-0000007',
      financedMinor: 84_000,
      remainingMinor: 84_000,
      instalments: [
        { no: 1, dueDate: '2026-10-30', amountMinor: 28_000, paidMinor: 0, state: 'due_today', daysLate: 0 },
        {
          no: 2,
          dueDate: '2026-11-30',
          amountMinor: 28_000,
          paidMinor: 10_000,
          state: 'partial',
          daysLate: 0,
        },
        { no: 3, dueDate: '2026-12-30', amountMinor: 28_000, paidMinor: 0, state: 'upcoming', daysLate: 0 },
      ],
    },
  ],
});

describe('what a payment settles', () => {
  it('fills the oldest open instalment first, and a partly paid one for what is left', () => {
    expect(allocationsFor(plans(), PLAN, 28_000)).toEqual([{ planId: PLAN, no: 1, amountMinor: 28_000 }]);
    expect(allocationsFor(plans(), PLAN, 40_000)).toEqual([
      { planId: PLAN, no: 1, amountMinor: 28_000 },
      { planId: PLAN, no: 2, amountMinor: 12_000 },
    ]);
    expect(allocationsFor(plans(), PLAN, 1_000_000)).toHaveLength(3);
    expect(allocationsFor(plans(), 'other', 5)).toEqual([]);
  });
});

describe('«قبض من زبون» with an instalment plan', () => {
  async function toReceipt(answer: CustomerInstalments | null) {
    const sets = posSets();
    const staff = staffServer(sets);
    const server = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).startsWith('/v1/device/installments/customer/')) {
        return new Response(JSON.stringify(answer), { status: answer ? 200 : 500 });
      }
      if (String(url).startsWith('/v1/device/customers/')) {
        return new Response(
          JSON.stringify({
            customerId: ids.abuKhaled,
            sizes: [],
            invoices: [],
            pieces: 0,
            spentMinor: 0,
            balanceMinor: 84_000,
          }),
          { status: 200 },
        );
      }
      return staff(url, init);
    }) as unknown as typeof fetch;
    const local = memoryLocal();
    await openShift(local);
    const pos = renderPos({ local, fetch: server });
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await pos.user.click(within(list).getByRole('button', { name: /سامر/ }));
    await pos.user.keyboard(PINS[ids.samer]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await pos.user.click(screen.getByRole('button', { name: 'المزيد' }));
    await pos.user.click(screen.getByRole('menuitem', { name: 'قبض من زبون' }));
    await pos.user.click(await screen.findByRole('button', { name: /أبو خالد/ }));
    return pos;
  }

  it('shows the open instalments, fills the next one, and sends the allocations with the receipt', async () => {
    const { user, outbox } = await toReceipt(plans());
    const pick = await screen.findByRole('region', { name: 'أقساط الزبون' });
    expect(within(pick).getAllByRole('listitem')).toHaveLength(3);
    await user.click(within(pick).getByRole('button', { name: /القسط القادم/ }));
    expect(screen.getByLabelText('المبلغ')).toHaveValue('280');
    await user.click(screen.getByRole('button', { name: /سجّل القبض/ }));
    await screen.findByRole('heading', { name: 'سُجّل القبض' });
    const payload = outbox.find((e) => e.type === 'receipt')!.doc.payload as unknown as ReceiptPayload;
    expect(validateDocumentPayload('receipt', payload)).toEqual({ ok: true, checked: true });
    expect(payload.amountMinor).toBe(28_000);
    expect(payload.allocations).toEqual([{ planId: PLAN, no: 1, amountMinor: 28_000 }]);
  });

  it('with the switch off the payment is a plain one', async () => {
    const { user, outbox } = await toReceipt(plans());
    const pick = await screen.findByRole('region', { name: 'أقساط الزبون' });
    await user.click(within(pick).getByRole('switch'));
    await user.type(screen.getByLabelText('المبلغ'), '100');
    await user.click(screen.getByRole('button', { name: /سجّل القبض/ }));
    await screen.findByRole('heading', { name: 'سُجّل القبض' });
    const payload = outbox.find((e) => e.type === 'receipt')!.doc.payload as unknown as ReceiptPayload;
    expect(payload.allocations).toBeUndefined();
  });

  it('shows nothing about instalments when the customer has none', async () => {
    await toReceipt({ today: '2026-10-30', plans: [] });
    await screen.findByLabelText('المبلغ');
    expect(screen.queryByRole('region', { name: 'أقساط الزبون' })).not.toBeInTheDocument();
  });

  it('asks before taking more than the customer owes, then records it once confirmed', async () => {
    const { user, outbox } = await toReceipt(plans());
    await screen.findByRole('region', { name: 'أقساط الزبون' });
    await vi.waitFor(() => expect(screen.getByText(/840/)).toBeInTheDocument());
    await user.type(screen.getByLabelText('المبلغ'), '9000');
    await user.click(screen.getByRole('button', { name: /سجّل القبض/ }));
    expect(await screen.findByText(/المبلغ أكبر من المستحق/)).toBeInTheDocument();
    expect(outbox.find((e) => e.type === 'receipt')).toBeUndefined();
    await user.click(screen.getByRole('button', { name: /نعم، سجّل والباقي رصيد/ }));
    await screen.findByRole('heading', { name: 'سُجّل القبض' });
    expect(outbox.find((e) => e.type === 'receipt')).toBeDefined();
  });
});
