import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromotionRow } from '@serva/core/contracts/promotions';
import type { SalePayload } from '@serva/core/contracts/documents';
import { validateDocumentPayload } from '@serva/core/contracts/documents';
import { verifySalePayload } from '@serva/core/sale';
import { DEFAULT_SCALE_BARCODE, ean13CheckDigit } from '@serva/core/scale';
import { stripBidiControls } from '@serva/core/text';
import { ids, posSets, PRODUCTS } from '../../test/pos';
import type { renderPos } from '../../test/renderPos';
import { saleScreen, scan } from '../../test/renderPos';

/** The supermarket mode at the till: promotions applied by themselves and scale labels. */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');
const cartLines = () => screen.getByRole('list', { name: 'أسطر الفاتورة' });
const due = () => screen.getByRole('status', { name: 'المطلوب' });

const promotion = (over: Partial<PromotionRow>): PromotionRow => ({
  id: '0192a000-0000-7000-8000-00000000c001',
  name: 'خصم الألبان 10%',
  kind: 'percent',
  percentBp: 1000,
  buyQty: null,
  getQty: null,
  scope: 'categories',
  categoryIds: [ids.dairy],
  productIds: [],
  startsAt: null,
  endsAt: null,
  daysOfWeek: [],
  fromTime: null,
  toTime: null,
  archived: false,
  version: 1,
  ...over,
});

async function payExact(user: ReturnType<typeof renderPos>['user']) {
  await user.keyboard('{F12}');
  const pay = await screen.findByRole('region', { name: 'الدفع' });
  await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
  await user.keyboard('{Enter}');
  await screen.findByRole('region', { name: 'تمت البيعة' });
}

function savedSale(outbox: ReturnType<typeof renderPos>['outbox']) {
  return outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
}

describe('promotions at the till', () => {
  it('takes a category promotion off by itself, names it, and the sale carries it as `promotion`', async () => {
    const sets = posSets({ promotions: [promotion({})] });
    const { user, outbox } = await saleScreen({ sets });
    await scan(user, PRODUCTS.milk.barcode!.code);
    await scan(user, PRODUCTS.sugar.barcode!.code);
    expect(plain(cartLines())).toContain('خصم الألبان 10%');
    // 500 − 50 + 790
    expect(plain(due())).toContain('1,240 ل.س');
    await payExact(user);
    const sale = savedSale(outbox);
    expect(validateDocumentPayload('sale', sale)).toEqual({ ok: true, checked: true });
    expect(verifySalePayload(sale)).toEqual([]);
    expect(sale.lines[0]!.discount).toEqual({
      type: 'amount',
      minor: 5_000,
      source: 'promotion',
      reason: 'خصم الألبان 10%',
      approval: null,
    });
    expect(sale.lines[1]!.discount).toBeNull();
  });

  it('buy two, the third free: the third sugar costs nothing, a stopped or off-hours offer does not run', async () => {
    const sets = posSets({
      promotions: [
        promotion({
          id: '0192a000-0000-7000-8000-00000000c002',
          name: 'اشترِ 2 والثالث مجاناً',
          kind: 'buy_get',
          percentBp: null,
          buyQty: 2,
          getQty: 1,
          scope: 'products',
          categoryIds: [],
          productIds: [PRODUCTS.sugar.product.id],
        }),
        promotion({ id: '0192a000-0000-7000-8000-00000000c003', name: 'متوقف', archived: true }),
        promotion({
          id: '0192a000-0000-7000-8000-00000000c004',
          name: 'بعد الإغلاق',
          endsAt: '2020-01-01T00:00:00.000Z',
        }),
      ],
    });
    const { user, outbox } = await saleScreen({ sets });
    await scan(user, PRODUCTS.sugar.barcode!.code);
    await scan(user, PRODUCTS.sugar.barcode!.code);
    await scan(user, PRODUCTS.sugar.barcode!.code);
    await scan(user, PRODUCTS.milk.barcode!.code);
    expect(plain(cartLines())).toContain('اشترِ 2 والثالث مجاناً');
    expect(plain(cartLines())).not.toContain('متوقف');
    // 3 × 790 − 790 + 500
    expect(plain(due())).toContain('2,080 ل.س');
    await payExact(user);
    const sale = savedSale(outbox);
    expect(sale.lines.map((l) => l.priced.lineDiscountMinor)).toEqual([79_000, 0]);
    expect(verifySalePayload(sale)).toEqual([]);
  });

  it('a discount the cashier types replaces the promotion on that line', async () => {
    const sets = posSets({ promotions: [promotion({})] });
    const { user } = await saleScreen({ sets });
    await scan(user, PRODUCTS.milk.barcode!.code);
    expect(plain(cartLines())).toContain('خصم الألبان 10%');
    await user.click(within(cartLines()).getByRole('button', { name: /حليب/ }));
    await user.click(within(cartLines()).getByRole('button', { name: 'خصم' }));
    const panel = await screen.findByRole('region', { name: 'خصم على السطر' });
    await user.keyboard('5');
    await user.click(within(panel).getByRole('button', { name: 'طبّق' }));
    expect(plain(cartLines())).not.toContain('خصم الألبان 10%');
    // 500 − 5%
    expect(plain(due())).toContain('475 ل.س');
  });
});

describe('scale labels', () => {
  /** Olives are sold by the kilo and carry their scale number 00123 as a barcode. */
  function scaleSets(kind: 'weight' | 'price' = 'weight') {
    const sets = posSets();
    sets.settings = [
      {
        ...sets.settings[0]!,
        scaleBarcode:
          kind === 'weight'
            ? DEFAULT_SCALE_BARCODE
            : { ...DEFAULT_SCALE_BARCODE, valueKind: 'price', valueDecimals: 0 },
      },
    ];
    sets.barcodes = [
      ...sets.barcodes,
      {
        id: '0192a000-0000-7000-8000-00000000b123',
        variantId: PRODUCTS.olives.variant.id,
        code: '00123',
        kind: 'standard',
        packQty: 1000,
        packName: null,
        packPriceMinor: null,
        version: 1,
      },
    ];
    return sets;
  }
  const label = (first12: string) => `${first12}${ean13CheckDigit(first12)}`;

  it('reads the weight off the label: 1.250 kg of olives at 300 ل.س', async () => {
    const { user, outbox } = await saleScreen({ sets: scaleSets() });
    await scan(user, label('210012301250'));
    expect(plain(cartLines())).toContain('زيتون أخضر');
    expect(plain(due())).toContain('375 ل.س');
    await payExact(user);
    const sale = savedSale(outbox);
    expect(sale.lines[0]).toMatchObject({ qty: 1250, unitName: 'كغ', barcode: '00123' });
    expect(verifySalePayload(sale)).toEqual([]);
  });

  it('reads a price label as the weight it buys', async () => {
    const { user } = await saleScreen({ sets: scaleSets('price') });
    await scan(user, label('210012300450'));
    // 450 ل.س of olives at 300 the kilo: 1.500 kg
    expect(plain(cartLines())).toContain('1.5');
    expect(plain(due())).toContain('450 ل.س');
  });

  it('says what to do when the scale number is no product’s barcode', async () => {
    const { user } = await saleScreen({ sets: scaleSets() });
    await scan(user, label('210099901250'));
    expect(await screen.findByText(/ملصق ميزان لصنف رقمه 00999/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'أسطر الفاتورة' })).toBeNull();
  });
});
