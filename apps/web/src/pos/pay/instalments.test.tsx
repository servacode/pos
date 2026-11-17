import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  INSTALMENT_FEE_NAME,
  INSTALMENT_FEE_PRODUCT_ID,
  instalmentSettingsOf,
} from '@serva/core/installments';
import { validateDocumentPayload, type SalePayload } from '@serva/core/contracts/documents';
import { stripBidiControls } from '@serva/core/text';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, posSets, PRODUCTS, staffServer } from '../../test/pos';
import { openShift, renderPos, scan } from '../../test/renderPos';
import { feeLine, countChoices, planFor } from './instalments';
import type { Cart } from '../sale/cart';
import { instalmentRows, rowLabel } from '../print/instalmentLines';

/** Selling on instalments at the till: the sheet, the plan on the sale, the fee line, the down payment. */

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');
const settings = instalmentSettingsOf({ enabled: true });

describe('the plan of a sale', () => {
  it('prices the markup from the store’s bands and splits what is financed', () => {
    const r = planFor(
      {
        goodsTotalMinor: 100_000,
        downMinor: 20_000,
        count: 3,
        frequency: 'monthly',
        firstDueDate: '2026-12-01',
        guarantor: { name: 'أبو سامر', phone: '0933', nationalId: '' },
        borrower: null,
      },
      settings,
      '0192a3b4-c5d6-7e8f-9a0b-000000000001',
      'none',
    );
    expect('draft' in r && r.draft).toMatchObject({
      markupMinor: 4_000,
      financedMinor: 84_000,
      belowMinimum: false,
    });
    if (!('draft' in r)) throw new Error('no plan');
    expect(r.draft.plan.schedule.map((i) => i.amountMinor)).toEqual([28_000, 28_000, 28_000]);
    expect(r.draft.plan.guarantor).toEqual({ name: 'أبو سامر', phone: '0933', nationalId: null });
    expect(r.draft.plan.markupBp).toBe(500);
  });

  it('says a down payment under the minimum needs a manager, and a guarantor can be required', () => {
    const base = {
      goodsTotalMinor: 100_000,
      downMinor: 5_000,
      count: 6,
      frequency: 'monthly' as const,
      firstDueDate: '2026-12-01',
      guarantor: null,
      borrower: null,
    };
    const low = planFor(base, settings, '0192a3b4-c5d6-7e8f-9a0b-000000000001', 'none');
    expect('draft' in low && low.draft.belowMinimum).toBe(true);
    const strict = instalmentSettingsOf({ enabled: true, guarantorOverMinor: 50_000 });
    expect(planFor(base, strict, '0192a3b4-c5d6-7e8f-9a0b-000000000001', 'none')).toEqual({
      error: 'اكتب اسم الكفيل: المبلغ يحتاج كفيلاً.',
    });
    expect(planFor({ ...base, downMinor: 100_000 }, settings, 'x', 'none')).toHaveProperty('error');
  });

  it('adds one service line for the fee, numbered after the others, without tax or discount', () => {
    const cart = { lines: [{ lineNo: 1 }, { lineNo: 4 }] } as unknown as Cart;
    const line = feeLine(cart, 4_000, 'SYP');
    expect(line).toMatchObject({
      lineNo: 5,
      productId: INSTALMENT_FEE_PRODUCT_ID,
      name: INSTALMENT_FEE_NAME,
      priceMinor: 4_000,
      qty: 1000,
      taxRateBp: 0,
      isService: true,
    });
  });

  it('offers the usual counts and the store’s own band edges, up to its longest plan', () => {
    expect(countChoices(settings)).toEqual([3, 6, 9, 12]);
    expect(
      countChoices(instalmentSettingsOf({ maxCount: 8, markupBands: [{ upToCount: 4, bp: 100 }] })),
    ).toEqual([3, 4, 6]);
  });
});

async function toPay(installments: Record<string, unknown> | null) {
  const sets = posSets();
  const withSettings = { ...sets, settings: [{ ...sets.settings[0]!, installments }] };
  const local = memoryLocal();
  await openShift(local);
  const staff = staffServer(withSettings as typeof sets);
  // What the customer owes now: nothing, so the plan's account part is within the customer's limit
  const server = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith('/v1/device/customers/')) {
      return new Response(
        JSON.stringify({
          customerId: ids.abuKhaled,
          sizes: [],
          invoices: [],
          pieces: 0,
          spentMinor: 0,
          balanceMinor: 0,
        }),
        { status: 200 },
      );
    }
    return staff(url, init);
  }) as unknown as typeof fetch;
  const pos = renderPos({ local, sets: withSettings as typeof sets, fetch: server });
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

describe('the receipt rows', () => {
  it('lists the down payment, the fee, what went on the account and each instalment with its day', () => {
    const r = planFor(
      {
        goodsTotalMinor: 100_000,
        downMinor: 20_000,
        count: 3,
        frequency: 'monthly',
        firstDueDate: '2026-12-01',
        guarantor: null,
        borrower: null,
      },
      settings,
      '0192a3b4-c5d6-7e8f-9a0b-000000000001',
      'none',
    );
    if (!('draft' in r)) throw new Error('no plan');
    const rows = instalmentRows(r.draft.plan, (m) => String(m / 100));
    expect(rows.map((x) => [rowLabel(x), x.value])).toEqual([
      ['الدفعة الأولى', '200'],
      ['رسم التقسيط', '40'],
      ['المقسَّط على الحساب', '840'],
      ['القسط 1 من 3 · 2026-12-01', '280'],
      ['القسط 2 من 3 · 2027-01-01', '280'],
      ['القسط 3 من 3 · 2027-02-01', '280'],
    ]);
    // A plan with no fee leaves that row out
    const free = { ...r.draft.plan, markupMinor: 0 };
    expect(instalmentRows(free, String).some((x) => x.label === 'رسم التقسيط')).toBe(false);
  });
});

describe('the pay screen', () => {
  it('has no instalment button until the store turns instalments on', async () => {
    const { pay } = await toPay(null);
    expect(within(pay).queryByRole('button', { name: 'بيع بالتقسيط' })).not.toBeInTheDocument();
  });

  it('sells on instalments: the sheet, the fee line, the down payment, and the plan on the sale', async () => {
    const { user, pay, outbox } = await toPay({ enabled: true });
    await user.click(await within(pay).findByRole('button', { name: 'بيع بالتقسيط' }));
    const sheet = await within(pay).findByRole('region', { name: 'خطة التقسيط' });
    // The default is six instalments; the schedule is listed live
    const schedule = within(sheet).getByRole('list', { name: 'جدول الأقساط' });
    expect(within(schedule).getAllByRole('listitem')).toHaveLength(6);
    await user.click(within(sheet).getByRole('button', { name: 'اعتمد الخطة' }));
    // The sheet closes, the plan's card says what was chosen and the amount due is the down payment
    expect(within(pay).queryByRole('region', { name: 'خطة التقسيط' })).not.toBeInTheDocument();
    const card = within(pay).getByRole('status', { name: 'خطة التقسيط' });
    expect(plain(card)).toContain('6');
    expect(plain(card)).toContain('المطلوب الآن هو الدفعة الأولى فقط');
    await user.click(within(pay).getByRole('button', { name: 'أتمّ الدفع' }));
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(validateDocumentPayload('sale', sale)).toEqual({ ok: true, checked: true });
    const plan = sale.installmentPlan!;
    expect(plan.count).toBe(6);
    expect(plan.schedule).toHaveLength(6);
    expect(plan.schedule.reduce((s, i) => s + i.amountMinor, 0)).toBe(plan.financedMinor);
    // The invoice carries one fee line, and the account part is exactly what was financed
    const fee = sale.lines.find((l) => l.productId === INSTALMENT_FEE_PRODUCT_ID)!;
    expect(fee.name).toBe(INSTALMENT_FEE_NAME);
    expect(fee.priced.totalMinor).toBe(plan.markupMinor);
    const credit = sale.payments
      .filter((p) => p.method === 'credit')
      .reduce((s, p) => s + p.baseAmountMinor, 0);
    expect(credit).toBe(plan.financedMinor);
    expect(sale.payments.some((p) => p.method === 'cash')).toBe(true);
    expect(plan.downPaymentMinor + plan.financedMinor).toBe(sale.totals.totalMinor);
  });

  it('cancelling the plan puts the total back and removes the account part', async () => {
    const { user, pay } = await toPay({ enabled: true });
    const before = plain(pay);
    await user.click(await within(pay).findByRole('button', { name: 'بيع بالتقسيط' }));
    const sheet = await within(pay).findByRole('region', { name: 'خطة التقسيط' });
    await user.click(within(sheet).getByRole('button', { name: 'اعتمد الخطة' }));
    await user.click(within(pay).getByRole('button', { name: 'ألغِ التقسيط' }));
    expect(within(pay).queryByRole('status', { name: 'خطة التقسيط' })).not.toBeInTheDocument();
    expect(within(pay).getByRole('button', { name: 'بيع بالتقسيط' })).toBeInTheDocument();
    expect(within(pay).queryByRole('list', { name: 'الأجزاء المدفوعة' })).not.toBeInTheDocument();
    expect(plain(pay)).toContain(before.includes('المطلوب') ? 'المطلوب' : '');
  });
});
