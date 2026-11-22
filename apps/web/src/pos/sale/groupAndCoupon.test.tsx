import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerRow } from '@serva/core/contracts/customers';
import type { PromotionRow } from '@serva/core/contracts/promotions';
import { validateDocumentPayload, type SalePayload } from '@serva/core/contracts/documents';
import { verifySalePayload } from '@serva/core/sale';
import { stripBidiControls } from '@serva/core/text';
import { ids, posSets, PRODUCTS } from '../../test/pos';
import type { renderPos } from '../../test/renderPos';
import { saleScreen, scan } from '../../test/renderPos';
import { clearInvoiceDiscount, groupDiscountOf, withGroupDiscount } from './groupDiscount';
import { COUPON_TEXT, resolveCoupon } from './CouponForm';
import { EMPTY_CART, type PricingContext } from './cart';

/** Round A5: the customer group's discount and a code typed at the till, both offline from what the till pulled. */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const GROUP = '0192a000-0000-7000-8000-0000000000d1';
const plain = (el: Element) => stripBidiControls(el.textContent ?? '');

const member = (over: Partial<CustomerRow> = {}): CustomerRow => ({
  id: ids.ummSamer,
  name: 'أم سامر',
  phone: null,
  creditLimitMinor: null,
  priceTier: 'retail',
  loyaltyPoints: 0,
  archived: false,
  version: 2,
  groupId: GROUP,
  groupName: 'جملة كبار',
  groupDiscountBps: 1000,
  ...over,
});

const coupon = (over: Partial<PromotionRow> = {}): PromotionRow => ({
  id: '0192a000-0000-7000-8000-00000000c0d1',
  name: 'خصم الصيف',
  kind: 'percent',
  percentBp: 1000,
  buyQty: null,
  getQty: null,
  scope: 'all',
  categoryIds: [],
  productIds: [],
  startsAt: null,
  endsAt: null,
  daysOfWeek: [],
  fromTime: null,
  toTime: null,
  // The server marks a coupon's offer archived so older tills never run it; the code rides beside it
  archived: true,
  couponCode: 'SUMMER10',
  version: 1,
  ...over,
});

function savedSale(outbox: ReturnType<typeof renderPos>['outbox']) {
  return outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
}

describe('the group discount, as the cart keeps it', () => {
  it('reads the group from the pulled customer and ignores no group, no percent or a nonsense percent', () => {
    expect(groupDiscountOf(member())).toEqual({ id: GROUP, name: 'جملة كبار', bp: 1000 });
    expect(groupDiscountOf(member({ groupDiscountBps: 0 }))).toBeNull();
    expect(groupDiscountOf(member({ groupId: null }))).toBeNull();
    expect(groupDiscountOf(member({ groupDiscountBps: 99_999 }))?.bp).toBe(10_000);
    expect(groupDiscountOf(undefined)).toBeNull();
  });

  it('puts the percent on the cart with the customer, keeps a typed discount, and takes it away with them', () => {
    const picked = withGroupDiscount(
      { ...EMPTY_CART, customer: { id: ids.ummSamer, name: 'أم سامر' } },
      member(),
    );
    expect(picked.invoiceDiscount).toEqual({ type: 'percent', bp: 1000 });
    expect(picked.invoiceGroup).toEqual({ id: GROUP, name: 'جملة كبار' });
    // The cashier's own discount stays
    const typed = { ...EMPTY_CART, invoiceDiscount: { type: 'amount' as const, minor: 500 } };
    expect(withGroupDiscount(typed, member())).toEqual(typed);
    // The customer removed: the group's discount goes, a manual one does not
    expect(withGroupDiscount(picked, undefined).invoiceDiscount).toBeNull();
    expect(withGroupDiscount(picked, undefined).invoiceGroup).toBeUndefined();
    // Another customer without a group
    expect(withGroupDiscount(picked, member({ groupId: null })).invoiceDiscount).toBeNull();
    // «أزله»
    const off = clearInvoiceDiscount(picked);
    expect(off.invoiceDiscount).toBeNull();
    expect(off.invoiceGroup).toBeUndefined();
  });
});

describe('a code typed at the till, resolved from the pulled offers', () => {
  const ctx = { currency: 'SYP', taxInclusive: true, rates: [] } as PricingContext;
  const at = new Date('2026-11-22T10:00:00Z');
  const cartWith = (productId: string) =>
    ({
      ...EMPTY_CART,
      lines: [
        {
          lineNo: 1,
          productId,
          variantId: 'v',
          name: 'x',
          qty: 1000,
          packQty: 1000,
          priceCurrency: 'SYP',
          priceMinor: 25_000,
          weighed: false,
        },
      ],
    }) as unknown as Parameters<typeof resolveCoupon>[2];
  const resolve = (typed: string, rows: PromotionRow[], cart = cartWith('p1')) =>
    resolveCoupon(typed, rows, cart, ctx, at, 'Asia/Damascus');

  it('finds the code whatever its case, and keeps the offer it opened', () => {
    expect(resolve(' summer10 ', [coupon()])).toEqual({
      ok: true,
      coupon: { code: 'SUMMER10', promotionId: coupon().id, name: 'خصم الصيف' },
    });
  });

  it('says why a code is refused: empty, unknown, not started, ended, outside its hours, for other goods', () => {
    expect(resolve('  ', [coupon()])).toEqual({ ok: false, error: COUPON_TEXT.empty });
    expect(resolve('NOPE', [coupon()])).toEqual({ ok: false, error: COUPON_TEXT.unknown });
    expect(resolve('SUMMER10', [coupon({ startsAt: '2026-12-01T00:00:00Z' })])).toEqual({
      ok: false,
      error: COUPON_TEXT.notStarted,
    });
    expect(resolve('SUMMER10', [coupon({ endsAt: '2026-11-01T00:00:00Z' })])).toEqual({
      ok: false,
      error: COUPON_TEXT.ended,
    });
    expect(resolve('SUMMER10', [coupon({ fromTime: '20:00', toTime: '23:00' })])).toEqual({
      ok: false,
      error: COUPON_TEXT.notNow,
    });
    expect(resolve('SUMMER10', [coupon({ scope: 'products', productIds: ['other'] })])).toEqual({
      ok: false,
      error: COUPON_TEXT.notApplicable,
    });
    // A kind the shop's codes do not open
    expect(resolve('SUMMER10', [coupon({ kind: 'tiered' })])).toEqual({
      ok: false,
      error: COUPON_TEXT.notApplicable,
    });
  });
});

describe('at the till', () => {
  it('a customer of a group brings the group discount, shown beside them, and the sale names the group', async () => {
    const sets = posSets({
      customers: [member(), ...posSets().customers.filter((c) => c.id !== ids.ummSamer)],
    });
    const { user, outbox } = await saleScreen({ sets });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /اختر الزبون/ }));
    const row = within(pay).getByRole('button', { name: /أم سامر/ });
    expect(row).toHaveTextContent('خصم المجموعة 10%');
    await user.click(row);
    // The cart now carries the group's percent as its invoice discount: 250 less 10%
    const note = await screen.findByRole('status', { name: 'خصم الفاتورة' });
    expect(plain(note)).toContain('خصم المجموعة جملة كبار 10%');
    expect(within(pay).getAllByText('خصم المجموعة 10%').length).toBeGreaterThan(0);
    await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });

    const sale = savedSale(outbox);
    expect(validateDocumentPayload('sale', sale)).toEqual({ ok: true, checked: true });
    expect(verifySalePayload(sale)).toEqual([]);
    expect(sale.customerId).toBe(ids.ummSamer);
    expect(sale.invoiceDiscount).toMatchObject({
      type: 'percent',
      bp: 1000,
      source: 'promotion',
      groupId: GROUP,
      approval: null,
    });
    expect(sale.totals.invoiceDiscountMinor).toBe(2_500);
    expect(sale.totals.totalMinor).toBe(22_500);
  });

  it('the cashier can remove the group discount, and the sale then carries none', async () => {
    const sets = posSets({ customers: [member()] });
    const { user, outbox } = await saleScreen({ sets });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /اختر الزبون/ }));
    await user.click(within(pay).getByRole('button', { name: /أم سامر/ }));
    const note = await screen.findByRole('status', { name: 'خصم الفاتورة' });
    await user.click(within(note).getByRole('button', { name: 'أزله' }));
    expect(screen.queryByRole('status', { name: 'خصم الفاتورة' })).not.toBeInTheDocument();
    await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = savedSale(outbox);
    expect(sale.invoiceDiscount ?? null).toBeNull();
    expect(sale.totals.totalMinor).toBe(25_000);
  });

  it('a typed code opens its offer offline, refuses a wrong one in words, and the sale carries the offer', async () => {
    const sets = posSets({ promotions: [coupon()] });
    const { user, outbox } = await saleScreen({ sets });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{Alt>}1{/Alt}');
    const panel = await screen.findByRole('region', { name: 'خصم على الفاتورة' });
    // The field is its own chunk: it shows a moment after the panel
    const field = await within(panel).findByLabelText('كود الخصم');
    await user.type(field, 'WRONG');
    await user.click(within(panel).getByRole('button', { name: 'طبّق الكود' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(COUPON_TEXT.unknown);
    await user.clear(field);
    await user.type(field, 'summer10{Enter}');
    const chip = await screen.findByRole('status', { name: 'كود الخصم' });
    expect(chip).toHaveTextContent('SUMMER10');
    // 250 less the offer's 10%
    expect(plain(screen.getByRole('status', { name: 'المطلوب' }))).toContain('225');

    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = savedSale(outbox);
    expect(verifySalePayload(sale)).toEqual([]);
    expect(sale.lines[0]!.discount).toMatchObject({
      source: 'promotion',
      promotionId: coupon().id,
      reason: 'خصم الصيف',
    });
    expect(sale.totals.totalMinor).toBe(22_500);
  });
});
