import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReturnPayload } from '@serva/core/contracts/documents';
import { validateDocumentPayload } from '@serva/core/contracts/documents';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import { buildSalePayload } from '@serva/core/sale';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, PRODUCTS } from '../../test/pos';
import { openShift, renderPos, SHIFT_ID } from '../../test/renderPos';

/**
 * Round 36 (decision 10): a sale paid in dollars is refunded from the dollar drawer by default, in the
 * same split the payment had; the cashier can change the dollars or send it all back in pounds.
 */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const USD_130 = { unit: 'USD', quote: 'SYP', rate: '130' } as const;

/** One jacket of 1,170.00 ل.س sold earlier on this till, paid as given */
async function toReturn(payments: Record<string, unknown>[]) {
  const local = memoryLocal();
  await openShift(local, ids.maryam);
  const { user, outbox, store } = renderPos({ local });
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await user.click(within(list).getByRole('button', { name: /مريم/ }));
  await user.keyboard(PINS[ids.maryam]!);
  await screen.findByRole('list', { name: 'الأصناف' });
  const payload = buildSalePayload({
    currency: 'SYP',
    taxInclusive: true,
    exchangeRates: [USD_130],
    shiftId: SHIFT_ID,
    cashierId: ids.maryam,
    cashSteps: {},
    lines: [
      {
        lineNo: 1,
        productId: PRODUCTS.oil.product.id,
        variantId: PRODUCTS.oil.variant.id,
        name: 'جاكيت',
        qty: 1000,
        priceCurrency: 'SYP',
        priceMinor: 117_000,
        taxRateBp: 0,
      },
    ],
    payments,
  } as never);
  await store.createDocument(
    { type: 'sale', businessDate: '2026-11-18', engineVersion: PRICING_ENGINE_VERSION, payload } as never,
    { now: Date.now(), newId: () => '0192a000-0000-7000-8000-0000000000aa' },
  );
  await user.keyboard('{Alt>}r{/Alt}');
  await user.click(await screen.findByRole('button', { name: /INV-001-002-0000001/ }));
  await user.click(screen.getByRole('button', { name: 'الكل' }));
  return { user, outbox };
}

const returnOf = (outbox: ReturnType<typeof renderPos>['outbox']) =>
  outbox.find((e) => e.type === 'return')!.doc.payload as unknown as ReturnPayload;

describe('the dollar drawer on the return screen', () => {
  it('offers the dollars the sale took, and refunds them from the dollar drawer', async () => {
    const { user, outbox } = await toReturn([{ method: 'cash', currency: 'USD', amountMinor: 900 }]);
    const field = screen.getByRole('textbox', { name: /من درج الدولار/ });
    expect(field).toHaveValue('9.00');
    expect(screen.getByText(/بسعر 130 ل.س للدولار/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    await screen.findByRole('heading', { name: 'سُجّل المرتجع' });
    const payload = returnOf(outbox);
    expect(validateDocumentPayload('return', payload)).toEqual({ ok: true, checked: true });
    expect(payload.refunds).toEqual([
      {
        method: 'cash',
        currency: 'SYP',
        amountMinor: 117_000,
        reference: null,
        foreign: [{ currency: 'USD', amountMinor: 900, baseAmountMinor: 117_000, rate: USD_130 }],
      },
    ]);
    // What the till's close expects: the dollars leave the dollar drawer, nothing leaves the pound drawer
    const { shiftActivity } = await import('../shift/shift');
    const activity = shiftActivity(SHIFT_ID, outbox.filter((e) => e.type === 'return') as never);
    expect(activity.terms.get('USD')!.refundsMinor).toBe(900);
    expect(activity.terms.get('SYP')?.refundsMinor ?? 0).toBe(0);
  });

  it('lets the cashier change the dollars: the rest comes from the pound drawer', async () => {
    const { user, outbox } = await toReturn([{ method: 'cash', currency: 'USD', amountMinor: 900 }]);
    const field = screen.getByRole('textbox', { name: /من درج الدولار/ });
    await user.clear(field);
    await user.type(field, '4');
    expect(screen.getByRole('status', { name: 'الباقي من درج الليرة' })).toHaveTextContent('650');
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    await screen.findByRole('heading', { name: 'سُجّل المرتجع' });
    expect(returnOf(outbox).refunds[0]).toMatchObject({
      amountMinor: 117_000,
      foreign: [{ currency: 'USD', amountMinor: 400, baseAmountMinor: 52_000 }],
    });
  });

  it('refunds all in pounds when the dollars are set to zero, as before', async () => {
    const { user, outbox } = await toReturn([{ method: 'cash', currency: 'USD', amountMinor: 900 }]);
    const field = screen.getByRole('textbox', { name: /من درج الدولار/ });
    await user.clear(field);
    await user.type(field, '0');
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    await screen.findByRole('heading', { name: 'سُجّل المرتجع' });
    expect(returnOf(outbox).refunds).toEqual([
      { method: 'cash', currency: 'SYP', amountMinor: 117_000, reference: null },
    ]);
  });

  it('never offers more dollars than the sale took', async () => {
    const { user, outbox } = await toReturn([
      { method: 'cash', currency: 'SYP', amountMinor: 58_500 },
      { method: 'cash', currency: 'USD', amountMinor: 450 },
    ]);
    const field = screen.getByRole('textbox', { name: /من درج الدولار/ });
    expect(field).toHaveValue('4.50');
    await user.clear(field);
    await user.type(field, '50');
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    await screen.findByRole('heading', { name: 'سُجّل المرتجع' });
    expect(returnOf(outbox).refunds[0]!.foreign).toEqual([
      { currency: 'USD', amountMinor: 450, baseAmountMinor: 58_500, rate: USD_130 },
    ]);
  });

  it('a pound sale shows no dollar field and refunds as always', async () => {
    const { user, outbox } = await toReturn([{ method: 'cash', currency: 'SYP', amountMinor: 117_000 }]);
    expect(screen.queryByRole('textbox', { name: /من درج الدولار/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    await screen.findByRole('heading', { name: 'سُجّل المرتجع' });
    expect(returnOf(outbox).refunds).toEqual([
      { method: 'cash', currency: 'SYP', amountMinor: 117_000, reference: null },
    ]);
  });
});
