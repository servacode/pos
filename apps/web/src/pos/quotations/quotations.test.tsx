import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import type { Quotation } from '@serva/core/contracts/quotations';
import { stripBidiControls } from '@serva/core/text';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, PRODUCTS, staffServer } from '../../test/pos';
import { openShift, renderPos, scan } from '../../test/renderPos';
import { quotationInputOf } from './api';

/** «عروض الأسعار» at the till: the quote button saves a numbered one, and an offer opens as the cart. */

/** What the till's slip said at the moment of printing (it leaves the page right after) */
let printed = '';
beforeEach(() => {
  printed = '';
  vi.spyOn(window, 'print').mockImplementation(() => {
    printed = plain(document.querySelector('[data-print-receipt]') ?? document.body);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Pos = ReturnType<typeof renderPos>;
const plain = (el: Element) => stripBidiControls(el.textContent ?? '');

async function signIn(user: Pos['user']) {
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await user.click(within(list).getByRole('button', { name: /سامر/ }));
  await user.keyboard(PINS[ids.samer]!);
  await screen.findByRole('list', { name: 'الأصناف' });
}

const sugar = PRODUCTS.sugar;

const OFFER: Quotation = {
  id: 'q-1',
  number: 'QUO-2026-000007',
  status: 'sent',
  customerName: 'مشفى الأمل',
  issueDate: '2026-11-01',
  validUntil: '2999-12-31',
  currency: 'SYP',
  totalMinor: 140_000,
  version: 3,
  customerId: null,
  customerPhone: null,
  customerTaxNumber: null,
  customerAddress: null,
  taxInclusive: true,
  notes: null,
  terms: null,
  lines: [
    {
      lineNo: 1,
      productId: sugar.product.id,
      variantId: sugar.variant.id,
      name: 'سكر أبيض 1 كغ',
      unitName: null,
      packName: null,
      packQty: 1000,
      qty: 2000,
      // The offered price is below the shelf's 790
      unitPriceMinor: 70_000,
      discount: null,
      taxRateId: null,
      taxRateBp: 0,
      priced: {
        grossMinor: 140_000,
        lineDiscountMinor: 0,
        netMinor: 140_000,
        taxMinor: 0,
        netExTaxMinor: 140_000,
        totalMinor: 140_000,
      },
    },
    {
      lineNo: 2,
      productId: null,
      variantId: null,
      name: 'صنف خاص بالمشفى',
      unitName: null,
      packName: null,
      packQty: 1000,
      qty: 1000,
      unitPriceMinor: 5_000,
      discount: null,
      taxRateId: null,
      taxRateBp: 0,
      priced: {
        grossMinor: 5_000,
        lineDiscountMinor: 0,
        netMinor: 5_000,
        taxMinor: 0,
        netExTaxMinor: 5_000,
        totalMinor: 5_000,
      },
    },
  ],
  invoiceDiscount: null,
  totals: {
    grossMinor: 145_000,
    lineDiscountMinor: 0,
    invoiceDiscountMinor: 0,
    discountMinor: 0,
    netExTaxMinor: 145_000,
    taxMinor: 0,
    totalMinor: 145_000,
  },
  convertedAt: null,
  createdByName: null,
  branchName: null,
  createdAt: '2026-11-01T08:00:00.000Z',
};

function server(open: Quotation[]) {
  const staff = staffServer();
  const sent: { url: string; method: string; body: unknown }[] = [];
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (!path.startsWith('/v1/device/quotations')) return staff(url, init);
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    sent.push({ url: path, method: init?.method ?? 'GET', body });
    if (path === '/v1/device/quotations' && !body) {
      return new Response(JSON.stringify({ items: open }), { status: 200 });
    }
    if (path === '/v1/device/quotations') {
      const made = { ...OFFER, id: 'q-9', number: 'QUO-2026-000009', version: 1, validUntil: '2026-11-30' };
      return new Response(JSON.stringify(made), { status: 201 });
    }
    return new Response(JSON.stringify({ ...OFFER, status: 'converted' }), { status: 200 });
  });
  return { fetch: fn as unknown as typeof fetch, sent };
}

describe('the quote button', () => {
  it('saves the cart as a numbered quotation and prints it with its number and last day', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { fetch, sent } = server([]);
    const { user, outbox } = renderPos({ local, fetch });
    await signIn(user);
    await scan(user, sugar.barcode!.code);
    await user.click(screen.getByRole('button', { name: 'عرض سعر' }));

    await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
    expect(printed).toContain('QUO-2026-000009');
    expect(printed).toContain('صالح حتى');
    expect(printed).not.toContain('لم يُحفظ');
    expect(sent[0]).toMatchObject({ url: '/v1/device/quotations', method: 'POST' });
    expect((sent[0]!.body as { lines: Record<string, unknown>[] }).lines[0]).toMatchObject({
      variantId: sugar.variant.id,
      qty: 1000,
      unitPriceMinor: 79_000,
    });
    // No sale: the cart stays, nothing in the outbox
    expect(outbox.filter((e) => e.type === 'sale')).toEqual([]);
  });

  it('still prints when the server does not answer, and says it was not saved', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user } = renderPos({ local });
    await signIn(user);
    await scan(user, sugar.barcode!.code);
    await user.click(screen.getByRole('button', { name: 'عرض سعر' }));
    await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
    expect(printed).toContain('لم يُحفظ في النظام');
    expect(printed).not.toContain('QUO-');
  });
});

describe('«عروض الأسعار» from the menu', () => {
  async function openList(user: Pos['user']) {
    await signIn(user);
    await user.click(screen.getByRole('button', { name: 'المزيد' }));
    await user.click(screen.getByRole('menuitem', { name: 'عروض الأسعار' }));
  }

  it('opens an offer as the cart at its offered prices, and marks it converted once sold', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { fetch, sent } = server([{ ...OFFER, lines: [OFFER.lines[0]!] }]);
    const { user, outbox } = renderPos({ local, fetch });
    await openList(user);
    const card = await screen.findByRole('listitem');
    expect(card).toHaveTextContent('QUO-2026-000007');
    expect(card).toHaveTextContent('مشفى الأمل');
    await user.click(within(card).getByRole('button', { name: 'افتحه في السلة' }));

    // The cart holds the sugar at the offered 700, twice
    await screen.findByRole('list', { name: 'الأصناف' });
    expect(plain(screen.getByRole('status', { name: 'المطلوب' }))).toContain('1,400 ل.س');
    expect(sent.some((s) => s.url.endsWith('/convert'))).toBe(false);

    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: 'نقد بالليرة' }));
    await user.keyboard('1400{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(sale.totals.totalMinor).toBe(140_000);
    await waitFor(() =>
      expect(sent.at(-1)).toMatchObject({
        url: '/v1/device/quotations/q-1/convert',
        method: 'POST',
        body: { version: 3 },
      }),
    );
  });

  it('says what could not be added', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { fetch } = server([OFFER]);
    const { user } = renderPos({ local, fetch });
    await openList(user);
    const card = await screen.findByRole('listitem');
    await user.click(within(card).getByRole('button', { name: 'افتحه في السلة' }));
    // The offer's second line is not an item of this till: it is named, then the cart follows
    expect(await screen.findByText(/صنف خاص بالمشفى/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'تابع إلى السلة' }));
    await screen.findByRole('list', { name: 'الأصناف' });
    expect(plain(screen.getByRole('status', { name: 'المطلوب' }))).toContain('1,400 ل.س');
  });

  it('needs the server', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user } = renderPos({ local });
    await openList(user);
    expect(await screen.findByText('تعذّر الوصول إلى الخادم.')).toBeInTheDocument();
  });
});

describe('quotationInputOf', () => {
  it('turns priced lines into a quotation input, a discount kept as it was', () => {
    const input = quotationInputOf(
      [
        {
          lineNo: 1,
          productId: sugar.product.id,
          variantId: sugar.variant.id,
          name: 'سكر',
          unitName: null,
          packQty: 1000,
          qty: 1000,
          unitPriceMinor: 79_000,
          discount: { type: 'percent', bp: 500, source: 'manual', reason: null, approval: null },
          taxRateId: null,
          taxRateBp: 0,
        } as never,
        {
          lineNo: 2,
          productId: sugar.product.id,
          variantId: sugar.variant.id,
          name: 'سكر',
          unitName: null,
          packQty: 1000,
          qty: 1000,
          unitPriceMinor: 79_000,
          discount: { type: 'amount', minor: 1_000, source: 'manual', reason: null, approval: null },
          taxRateId: null,
          taxRateBp: 0,
        } as never,
      ],
      null,
      { id: 'c-1', name: 'ريم' },
      null,
    );
    expect(input).toMatchObject({ customerId: 'c-1', customerName: 'ريم' });
    expect(input.lines.map((l) => l.discount)).toEqual([
      { type: 'percent', bp: 500 },
      { type: 'amount', minor: 1_000 },
    ]);
  });
});
