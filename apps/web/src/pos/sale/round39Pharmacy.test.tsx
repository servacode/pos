import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import type { PharmacySettings, StockBatch } from '@serva/core/contracts/pharmacy';
import { stripBidiControls } from '@serva/core/text';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, posSets, PRODUCTS, staffServer } from '../../test/pos';
import { openShift, renderPos, saleScreen, scan } from '../../test/renderPos';

/**
 * Round 39, the pharmacy trial's till findings: choosing an alternative replaces the blocked line, the pay button
 * says which line and why, one warning per item, «بدائل» in the no-stock question, a partial sale on credit
 * keeps the typed part.
 */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');
const EXPIRED: StockBatch = { batchNo: 'A-01', expiry: '2020-01-31', qty: 9000, blocked: false };
const PHARMACY: PharmacySettings = { prescription: 'optional', blockNoBatch: true };

function sets(batches: StockBatch[], alternativeStock = 4000) {
  const s = posSets();
  s.products = s.products.map((p) => {
    if (p.id === PRODUCTS.tea.product.id)
      return {
        ...p,
        nameAr: 'أموكسيل 500',
        genericName: 'أموكسيسيلين',
        strength: '500 ملغ',
        dosageForm: 'كبسولات',
      };
    if (p.id === PRODUCTS.sugar.product.id)
      return {
        ...p,
        nameAr: 'أوسباموكس 500',
        genericName: 'أموكسيسيلين',
        strength: '500 ملغ',
        dosageForm: 'كبسولات',
      };
    return p;
  });
  s.stock_levels = [
    {
      id: PRODUCTS.tea.variant.id,
      branchId: ids.tenant,
      variantId: PRODUCTS.tea.variant.id,
      qty: batches.reduce((sum, b) => sum + b.qty, 0),
      reservedQty: 0,
      batches,
      version: 1,
    },
    {
      id: PRODUCTS.sugar.variant.id,
      branchId: ids.tenant,
      variantId: PRODUCTS.sugar.variant.id,
      qty: alternativeStock,
      reservedQty: 0,
      version: 1,
    },
  ] as typeof s.stock_levels;
  s.settings = s.settings.map((x) => ({
    ...x,
    pharmacy: PHARMACY,
    till: { returnWindowDays: null, cardApprovalRequired: false },
  }));
  return s;
}

async function openWarnings(user: Awaited<ReturnType<typeof saleScreen>>['user']) {
  const row = await screen.findByRole('button', { name: /^(تنبيه واحد|تنبيهان|d+ تنبيهات)$/ });
  if (row.getAttribute('aria-expanded') !== 'true') await user.click(row);
}

describe('a blocked line and the alternative chosen for it', () => {
  it('is replaced by the alternative, which then pays', async () => {
    const { user } = await saleScreen({ sets: sets([EXPIRED]) });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await openWarnings(user);
    await user.click(await screen.findByRole('button', { name: 'بدائل متوفرة' }));
    const panel = await screen.findByRole('region', { name: 'بدائل متوفرة' });
    expect(within(panel).getByText(/يحل محل «أموكسيل 500»/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /أوسباموكس 500/ }));
    const cart = await screen.findByRole('list', { name: 'أسطر الفاتورة' });
    expect(within(cart).getByText(/أوسباموكس 500/)).toBeInTheDocument();
    expect(within(cart).queryByText(/أموكسيل 500/)).toBeNull();
    // Nothing is held now: the pay screen opens
    await user.keyboard('{F12}');
    expect(await screen.findByRole('region', { name: 'الدفع' })).toBeInTheDocument();
  });

  it('keeps a line that is not blocked when an alternative is added beside it', async () => {
    const { user } = await saleScreen({
      sets: sets([{ batchNo: 'G-1', expiry: '2099-01-31', qty: 3000, blocked: false }]),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.click(screen.getByRole('button', { name: 'بدائل الصنف' }));
    const panel = await screen.findByRole('region', { name: 'بدائل متوفرة' });
    expect(within(panel).queryByText(/يحل محل/)).toBeNull();
    await user.click(within(panel).getByRole('button', { name: /أوسباموكس 500/ }));
    const cart = await screen.findByRole('list', { name: 'أسطر الفاتورة' });
    expect(within(cart).getByText(/أموكسيل 500/)).toBeInTheDocument();
    expect(within(cart).getByText(/أوسباموكس 500/)).toBeInTheDocument();
  });

  it('names the line and the reason beside the pay button, and warns once for the item', async () => {
    // No batch at all and none on the shelf: the line has no valid batch and the item is also short of stock
    const { user } = await saleScreen({ sets: sets([]) });
    await scan(user, PRODUCTS.tea.barcode!.code);
    // «لا يوجد مخزون»: the cashier sells it anyway, and the batch rule holds the payment
    await user.click(await screen.findByRole('button', { name: 'نعم، بِع على كل حال' }));
    const reason = await screen.findByRole('button', { name: /«أموكسيل 500»: لا توجد دفعة صالحة منه/ });
    expect(plain(reason)).toContain('احذفه أو اختر بديلاً');
    await openWarnings(user);
    const rows = screen.getAllByRole('alert').filter((el) => /أموكسيل 500/.test(plain(el)));
    expect(rows).toHaveLength(1);
    expect(plain(rows[0]!)).not.toMatch(/الموجود 0/);
  });

  it('says the batches expired when they did', async () => {
    const { user } = await saleScreen({ sets: sets([EXPIRED]) });
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(
      await screen.findByRole('button', { name: /«أموكسيل 500»: دفعاته منتهية الصلاحية ولا تكفي/ }),
    ).toBeInTheDocument();
  });
});

describe('«لا يوجد مخزون»', () => {
  it('offers «بدائل» in a pharmacy, and opens the alternatives for that item', async () => {
    const { user } = await saleScreen({ sets: sets([], 0) });
    // The item with none on the shelf gives the question
    await scan(user, PRODUCTS.sugar.barcode!.code);
    expect(await screen.findByText(/نفد من المخزون/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'بدائل' }));
    expect(await screen.findByRole('region', { name: 'بدائل متوفرة' })).toBeInTheDocument();
  });
});

describe('a partial sale on credit', () => {
  async function toPay() {
    const local = memoryLocal();
    await openShift(local);
    const s = posSets();
    const staff = staffServer(s);
    const fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
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
    }) as unknown as typeof globalThis.fetch;
    const pos = renderPos({ local, sets: s, fetch });
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

  it('hints at «آجل على الحساب» when a customer is picked and the typed amount is short', async () => {
    const { user, pay } = await toPay();
    await user.keyboard('100');
    expect(
      await within(pay).findByText(/اضغط «آجل على الحساب» ليُسجَّل المتبقي ديناً على الزبون/),
    ).toBeInTheDocument();
  });

  it('keeps the typed part as cash and puts only the rest on the account: paid now + on credit = total', async () => {
    const { user, pay, outbox } = await toPay();
    await user.keyboard('100');
    await user.click(await within(pay).findByRole('button', { name: 'آجل على الحساب' }));
    const summary = await within(pay).findByRole('status', { name: 'ملخص الدفع' });
    const text = plain(summary);
    expect(text).toMatch(/مدفوع الآن\s*100/);
    expect(text).toMatch(/آجل على الحساب\s*150/);
    expect(text).toMatch(/المجموع\s*250/);
    await user.click(within(pay).getByRole('button', { name: 'أتمّ الدفع' }));
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(sale.payments.map((p) => [p.method, p.amountMinor])).toEqual([
      ['cash', 10_000],
      ['credit', 15_000],
    ]);
  });

  it('puts the whole invoice on the account when nothing was typed', async () => {
    const { user, pay, outbox } = await toPay();
    await user.click(await within(pay).findByRole('button', { name: 'آجل على الحساب' }));
    expect(within(pay).queryByRole('status', { name: 'ملخص الدفع' })).toBeNull();
    await user.click(within(pay).getByRole('button', { name: 'أتمّ الدفع' }));
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(sale.payments.map((p) => [p.method, p.amountMinor])).toEqual([['credit', 25_000]]);
  });
});

describe('«أضف صنف جديد» in a pharmacy', () => {
  const newBarcode = '6291099900011';

  async function toPanel(pharmacy: boolean) {
    const local = memoryLocal();
    await openShift(local, ids.maryam);
    const s = posSets();
    s.roles = s.roles.map((r) =>
      r.key === 'manager' ? { ...r, permissions: [...r.permissions, 'catalog.manage'] } : r,
    );
    s.settings = s.settings.map((x) => ({ ...x, pharmacy: pharmacy ? PHARMACY : null }));
    const staff = staffServer(s);
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/v1/device/products') {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({ productId: 'p-1', variantId: 'v-1', nameAr: 'سيتال 500', barcode: newBarcode }),
          { status: 201 },
        );
      }
      return staff(url, init);
    }) as unknown as typeof globalThis.fetch;
    const pos = renderPos({ local, fetch, sets: s });
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await pos.user.click(within(list).getByRole('button', { name: /مريم/ }));
    await pos.user.keyboard(PINS[ids.maryam]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(pos.user, newBarcode);
    await pos.user.click(
      within(await screen.findByRole('alert')).getByRole('button', { name: 'أضف صنف جديد' }),
    );
    const panel = await screen.findByRole('region', { name: 'أضف صنف جديد' });
    await pos.user.type(within(panel).getByLabelText('اسم الصنف'), 'سيتال 500');
    await pos.user.type(within(panel).getByLabelText('السعر'), '1500');
    return { ...pos, panel, bodies };
  }

  it('asks the generic name, strength and form (all optional), sends them, and puts the product in the cart', async () => {
    const { user, panel, bodies } = await toPanel(true);
    await user.type(within(panel).getByLabelText('الاسم العلمي'), 'باراسيتامول');
    await user.type(within(panel).getByLabelText('التركيز'), '500 ملغ');
    await user.type(within(panel).getByLabelText('الشكل الدوائي'), 'أقراص');
    await user.click(within(panel).getByRole('button', { name: 'أضف الصنف' }));
    expect(await screen.findByText(/وصار في السلة/)).toBeInTheDocument();
    expect(bodies).toEqual([
      expect.objectContaining({
        nameAr: 'سيتال 500',
        genericName: 'باراسيتامول',
        strength: '500 ملغ',
        dosageForm: 'أقراص',
      }),
    ]);
    const cart = await screen.findByRole('list', { name: 'أسطر الفاتورة' });
    expect(within(cart).getByText(/سيتال 500/)).toBeInTheDocument();
    // No «لا يوجد مخزون» question for what the cashier just made
    expect(screen.queryByText(/نفد من المخزون/)).toBeNull();
  });

  it('sends none of them when left empty, and a store that is not a pharmacy is not asked', async () => {
    const empty = await toPanel(true);
    await empty.user.click(within(empty.panel).getByRole('button', { name: 'أضف الصنف' }));
    await screen.findByText(/وصار في السلة/);
    expect(empty.bodies[0]).not.toHaveProperty('genericName');
    expect(empty.bodies[0]).not.toHaveProperty('strength');
  });

  it('is not asked in a store that is not a pharmacy, which also gets the product in the cart', async () => {
    const plainStore = await toPanel(false);
    expect(within(plainStore.panel).queryByLabelText('الاسم العلمي')).toBeNull();
    await plainStore.user.click(within(plainStore.panel).getByRole('button', { name: 'أضف الصنف' }));
    expect(await screen.findByText(/وصار في السلة/)).toBeInTheDocument();
  });
});
