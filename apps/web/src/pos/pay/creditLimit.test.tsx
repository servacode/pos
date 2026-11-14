import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import { stripBidiControls } from '@serva/core/text';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, posSets, PRODUCTS, staffServer } from '../../test/pos';
import { openShift, renderPos, scan } from '../../test/renderPos';

/** A sale on account against the customer's limit, and what the done screen and the receipt say. */

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');

/** The till's server: staff sign-in as always, and what a customer owes now */
function server(owed: number, sets = posSets()) {
  const staff = staffServer(sets);
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith('/v1/device/customers/')) {
      return new Response(
        JSON.stringify({
          customerId: ids.abuKhaled,
          sizes: [],
          invoices: [],
          pieces: 0,
          spentMinor: 0,
          balanceMinor: owed,
        }),
        {
          status: 200,
        },
      );
    }
    return staff(url, init);
  }) as unknown as typeof fetch;
}

async function toCredit(owed: number, till?: Record<string, unknown>) {
  const sets = posSets();
  const withTill = till ? { ...sets, settings: [{ ...sets.settings[0]!, till }] } : sets;
  const local = memoryLocal();
  await openShift(local);
  const pos = renderPos({
    local,
    sets: withTill as typeof sets,
    fetch: server(owed, withTill as typeof sets),
  });
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await pos.user.click(within(list).getByRole('button', { name: /سامر/ }));
  await pos.user.keyboard(PINS[ids.samer]!);
  await screen.findByRole('list', { name: 'الأصناف' });
  await scan(pos.user, PRODUCTS.oil.barcode!.code);
  await pos.user.keyboard('{F12}');
  const pay = await screen.findByRole('region', { name: 'الدفع' });
  await pos.user.click(within(pay).getByRole('button', { name: /اختر الزبون/ }));
  await pos.user.click(within(pay).getByRole('button', { name: /أبو خالد/ }));
  return { ...pos, pay };
}

describe('a cashier sells on account', () => {
  it('shows what each customer owes now in the picker', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user } = renderPos({ local, fetch: server(50_000) });
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(list).getByRole('button', { name: /سامر/ }));
    await user.keyboard(PINS[ids.samer]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /اختر الزبون/ }));
    const customers = await within(pay).findByRole('list', { name: 'الزبائن' });
    await vi.waitFor(() => expect(plain(customers)).toContain('عليه'));
    await user.click(within(customers).getByRole('button', { name: /أبو خالد/ }));
    expect(await within(pay).findByText('أبو خالد')).toBeInTheDocument();
  });

  it('within the customer’s limit with no code, and the done screen says what stays on the account', async () => {
    const { user, pay, outbox } = await toCredit(50_000);
    await user.click(await within(pay).findByRole('button', { name: 'آجل على الحساب' }));
    expect(within(pay).queryByText(/يتجاوز حد الزبون/)).not.toBeInTheDocument();
    await user.click(within(pay).getByRole('button', { name: 'أتمّ الدفع' }));
    const done = await screen.findByRole('region', { name: 'تمت البيعة' });
    expect(screen.queryByRole('region', { name: 'رمز المدير' })).not.toBeInTheDocument();
    expect(plain(within(done).getByRole('status'))).toContain('على حساب الزبون');
    expect(plain(done)).not.toContain('المبلغ مدفوع تماماً');
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(sale.customerBalanceAfterMinor).toBe(75_000);
    // The receipt prints the new balance and the signature line
    expect(within(done).getByText('رصيد الزبون الجديد')).toBeInTheDocument();
    expect(within(done).getByText('توقيع المستلم')).toBeInTheDocument();
  });

  it('over the limit says by how much before it asks a manager’s code', async () => {
    const { user, pay, outbox } = await toCredit(90_000);
    await user.click(await within(pay).findByRole('button', { name: 'آجل على الحساب' }));
    expect(plain(pay)).toContain('يتجاوز حد الزبون بـ');
    expect(plain(pay)).toContain('150');
    await user.click(within(pay).getByRole('button', { name: 'أتمّ الدفع' }));
    expect(await screen.findByRole('region', { name: 'رمز المدير' })).toBeInTheDocument();
    expect(outbox.some((e) => e.type === 'sale')).toBe(false);
  });

  it('is refused over the limit when the store says so', async () => {
    const { pay } = await toCredit(90_000, {
      returnWindowDays: null,
      cardApprovalRequired: false,
      creditOverLimit: 'block',
    });
    await within(pay)
      .findByRole('button', { name: 'آجل على الحساب' })
      .then((b) => b.click());
    expect(plain(pay)).toContain('لا يُباع له بالآجل فوق الحد');
    expect(within(pay).getByRole('button', { name: 'أتمّ الدفع' })).toBeDisabled();
  });
});
