import { describe, expect, it } from 'vitest';
import { createProductInput, updateProductInput } from '@serva/core';
import { ids, product, variant } from '../../test/catalog';
import {
  applyAxes,
  axesOf,
  buildCreate,
  buildUpdate,
  changedParts,
  draftFromDetail,
  emptyDraft,
  errorsFromServer,
  isEmptyUpdate,
  newBarcode,
  qtyFromText,
  qtyText,
  validateBuilt,
  type Axis,
  type ProductDraft,
} from './form';

const axis = (name: string, values: string[]): Axis => ({ key: `a-${name}`, name, values });

function simpleDraft(): ProductDraft {
  const draft = emptyDraft({ currency: 'SYP', unitId: ids.piece });
  draft.nameAr = 'سكر أبيض 1 كغ';
  draft.variants[0]!.priceMinor = 12000;
  return draft;
}

describe('quantities typed in the card', () => {
  it('reads and shows thousandths', () => {
    expect(qtyText(12000)).toBe('12');
    expect(qtyText(2500)).toBe('2.5');
    expect(qtyText(250)).toBe('0.25');
    expect(qtyText(null)).toBe('');
    expect(qtyFromText('')).toBeNull();
    expect(qtyFromText('2.5')).toBe(2500);
    expect(qtyFromText('12.')).toBe(12000);
  });

  it('round-trips every quantity', () => {
    for (let thousandths = 0; thousandths <= 30_000; thousandths += 7) {
      expect(qtyFromText(qtyText(thousandths))).toBe(thousandths);
    }
    expect(qtyFromText(qtyText(123_456_789))).toBe(123_456_789);
  });
});

describe('the create body', () => {
  it('sends the product with its one variant, price and barcodes, and passes the contract', () => {
    const draft = simpleDraft();
    draft.categoryId = ids.dairy;
    draft.variants[0]!.barcodes = [newBarcode('standard', '6290360100125'), newBarcode('internal')];
    draft.variants[0]!.minStock = '5';
    const built = buildCreate(draft);

    expect(built.body).toEqual({
      nameAr: 'سكر أبيض 1 كغ',
      nameEn: null,
      brand: null,
      categoryId: ids.dairy,
      type: 'stock',
      unitId: ids.piece,
      taxRateId: null,
      sellOnPos: true,
      variants: [
        {
          sku: null,
          attributes: [],
          price: { currency: 'SYP', priceMinor: 12000 },
          minPriceMinor: null,
          minStockQty: 5000,
          barcodes: [
            { kind: 'standard', code: '6290360100125', packQty: 1000, packName: null, packPriceMinor: null },
            // No code: the server makes the next internal one (prefix 29).
            { kind: 'internal', packQty: 1000, packName: null, packPriceMinor: null },
          ],
        },
      ],
    });
    expect(createProductInput.safeParse(built.body).success).toBe(true);
    expect(validateBuilt(built, 'create')).toEqual({});
  });

  it('puts a missing name and a missing price on their fields, in Arabic', () => {
    const draft = emptyDraft({ currency: 'SYP', unitId: ids.piece });
    const errors = validateBuilt(buildCreate(draft), 'create');
    expect(errors.nameAr).toBe('اسم المنتج مطلوب');
    expect(errors[`v.${draft.variants[0]!.key}.price`]).toBe('اكتب سعر البيع');
  });

  it('puts a repeated barcode on the second row', () => {
    const draft = simpleDraft();
    const second = newBarcode('standard', '6290360100125');
    draft.variants[0]!.barcodes = [newBarcode('standard', '6290360100125'), second];
    expect(validateBuilt(buildCreate(draft), 'create')[`b.${second.key}.code`]).toBe(
      'الباركود مكرر في هذا المنتج',
    );
  });
});

describe('the PATCH body (17: only what changed)', () => {
  it('is empty when nothing changed', () => {
    const detail = product();
    const built = buildUpdate(draftFromDetail(detail), detail);
    expect(built.body).toEqual({ version: 3 });
    expect(isEmptyUpdate(built.body)).toBe(true);
  });

  it('sends a price change as { id, price } of that variant only', () => {
    const detail = product();
    const draft = draftFromDetail(detail);
    draft.variants[0]!.priceMinor = 16000;
    expect(buildUpdate(draft, detail).body).toEqual({
      version: 3,
      variants: [{ id: ids.milkVariant, price: { currency: 'SYP', priceMinor: 16000 } }],
    });
  });

  it('sends a dollar price in dollars, and clears a field with null', () => {
    const detail = product({ brand: 'المراعي' });
    const draft = draftFromDetail(detail);
    draft.brand = '  ';
    draft.variants[0]!.currency = 'USD';
    draft.variants[0]!.priceMinor = 125;
    const { body } = buildUpdate(draft, detail);
    expect(body).toEqual({
      version: 3,
      brand: null,
      variants: [{ id: ids.milkVariant, price: { currency: 'USD', priceMinor: 125 } }],
    });
    expect(updateProductInput.safeParse(body).success).toBe(true);
  });

  it('sends a variant’s whole barcode list when one is added', () => {
    const detail = product();
    const draft = draftFromDetail(detail);
    draft.variants[0]!.barcodes.push(newBarcode('standard', '16281007035102'));
    expect(buildUpdate(draft, detail).body.variants).toEqual([
      {
        id: ids.milkVariant,
        barcodes: [
          {
            id: ids.milkBarcode,
            kind: 'standard',
            code: '6281007035105',
            packQty: 1000,
            packName: null,
            packPriceMinor: null,
          },
          { kind: 'standard', code: '16281007035102', packQty: 1000, packName: null, packPriceMinor: null },
        ],
      },
    ]);
  });
});

describe('the size × colour matrix (contract Q8)', () => {
  it('makes every combination, and the simple product’s variant becomes the first', () => {
    const detail = product();
    const draft = draftFromDetail(detail);
    const variants = applyAxes(draft.variants, [axis('المقاس', ['S', 'M']), axis('اللون', ['أحمر', 'أزرق'])]);

    expect(variants.map((v) => v.attributes.map((a) => a.value).join('/'))).toEqual([
      'S/أحمر',
      'S/أزرق',
      'M/أحمر',
      'M/أزرق',
    ]);
    expect(variants[0]!.id).toBe(ids.milkVariant);
    expect(variants[0]!.barcodes).toHaveLength(1);
    expect(
      variants.slice(1).every((v) => v.id === undefined && v.priceMinor === 15000 && v.barcodes.length === 0),
    ).toBe(true);

    const { body } = buildUpdate({ ...draft, variants }, detail);
    expect(body.variants).toHaveLength(4);
    expect(body.variants?.[0]).toEqual({
      id: ids.milkVariant,
      attributes: [
        { name: 'المقاس', value: 'S' },
        { name: 'اللون', value: 'أحمر' },
      ],
    });
    expect(updateProductInput.safeParse(body).success).toBe(true);
  });

  it('archives a saved variant that left the matrix, drops a new one, and brings one back', () => {
    const detail = product({
      id: ids.kettle,
      variants: [
        variant({ id: ids.white, attributes: [{ name: 'اللون', value: 'أبيض' }], barcodes: [] }),
        variant({ id: ids.black, attributes: [{ name: 'اللون', value: 'أسود' }], barcodes: [] }),
      ],
    });
    const draft = draftFromDetail(detail);
    expect(draft.axes.map((a) => [a.name, a.values])).toEqual([['اللون', ['أبيض', 'أسود']]]);

    const withRed = applyAxes(draft.variants, [axis('اللون', ['أبيض', 'أسود', 'أحمر'])]);
    const withoutBlack = applyAxes(withRed, [axis('اللون', ['أبيض'])]);
    expect(withoutBlack.map((v) => [v.attributes[0]?.value, v.archived])).toEqual([
      ['أبيض', false],
      ['أسود', true],
    ]);
    expect(buildUpdate({ ...draft, variants: withoutBlack }, detail).body.variants).toEqual([
      { id: ids.black, archived: true },
    ]);

    const back = applyAxes(withoutBlack, [axis('اللون', ['أبيض', 'أسود'])]);
    expect(back.every((v) => !v.archived)).toBe(true);
    expect(isEmptyUpdate(buildUpdate({ ...draft, variants: back }, detail).body)).toBe(true);
  });

  it('renames an axis without losing its variants', () => {
    const detail = product({
      variants: [
        variant({ id: ids.white, attributes: [{ name: 'اللون', value: 'أبيض' }] }),
        variant({ id: ids.black, attributes: [{ name: 'اللون', value: 'أسود' }], barcodes: [] }),
      ],
    });
    const draft = draftFromDetail(detail);
    const variants = applyAxes(draft.variants, [axis('اللون والسعة', ['أبيض', 'أسود'])]);
    expect(variants.map((v) => v.id)).toEqual([ids.white, ids.black]);
    expect(variants[0]!.attributes).toEqual([{ name: 'اللون والسعة', value: 'أبيض' }]);
  });

  it('turns back into a simple product: one variant without options, the rest archived', () => {
    const detail = product({
      variants: [
        variant({ id: ids.white, attributes: [{ name: 'اللون', value: 'أبيض' }] }),
        variant({ id: ids.black, attributes: [{ name: 'اللون', value: 'أسود' }], barcodes: [] }),
      ],
    });
    const variants = applyAxes(draftFromDetail(detail).variants, []);
    expect(variants.map((v) => [v.id, v.attributes.length, v.archived])).toEqual([
      [ids.white, 0, false],
      [ids.black, 1, true],
    ]);
  });

  it('always has one live variant per combination, whatever the axes and the edits before', () => {
    const lists = [[], ['S'], ['S', 'M'], ['S', 'M', 'L', 'XL']];
    const colours = [[], ['أحمر'], ['أحمر', 'أزرق', 'أسود']];
    let variants = simpleDraft().variants;
    for (const sizes of lists) {
      for (const colour of colours) {
        const axes = [axis('المقاس', sizes), axis('اللون', colour)];
        variants = applyAxes(variants, axes);
        const live = variants.filter((v) => !v.archived);
        const used = axes.filter((a) => a.values.length > 0);
        const expected = used.length === 0 ? 1 : used.reduce((n, a) => n * a.values.length, 1);
        expect(live).toHaveLength(expected);
        expect(new Set(live.map((v) => JSON.stringify(v.attributes))).size).toBe(expected);
      }
    }
  });

  it('reads no axes from a simple product', () => {
    expect(axesOf(draftFromDetail(product()).variants)).toEqual([]);
  });
});

describe('server errors back to the fields', () => {
  it('maps variant and barcode paths through what was sent', () => {
    const detail = product();
    const draft = draftFromDetail(detail);
    const added = newBarcode('standard', '6111111111111');
    draft.variants[0]!.barcodes.push(added);
    const built = buildUpdate(draft, detail);

    expect(
      errorsFromServer(
        {
          nameAr: 'اسم المنتج مطلوب',
          'variants.0.barcodes.1.code': 'الباركود 6111111111111 مستعمل في «شاي 400 غ»',
          'variants.0.price.priceMinor': 'السعر غير صالح',
          'something.else': 'خطأ',
        },
        built.sent,
      ),
    ).toEqual({
      nameAr: 'اسم المنتج مطلوب',
      [`b.${added.key}.code`]: 'الباركود 6111111111111 مستعمل في «شاي 400 غ»',
      [`v.${ids.milkVariant}.price`]: 'السعر غير صالح',
      something: 'خطأ',
    });
  });

  it('never shows an English message', () => {
    expect(errorsFromServer({ nameAr: 'Required' }, { variants: [] })).toEqual({
      nameAr: 'تحقّق من هذه الخانة',
    });
  });
});

describe('what another person changed', () => {
  it('names the parts', () => {
    const before = product();
    const after = product({
      version: 4,
      nameAr: 'حليب كامل الدسم',
      variants: [variant({ price: { currency: 'SYP', priceMinor: 16000 } })],
    });
    expect(changedParts(before, after)).toEqual(['الاسم', 'السعر']);
    expect(changedParts(before, before)).toEqual([]);
  });
});
