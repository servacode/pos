import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, ProductDetail, SupplierListResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { productsPath } from '../catalog/api';
import { moneyOf, qtyOf } from './api';
import { parseRunCounts, sizeRunQuantities } from './SizeGrid';

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: {
      ...base.user,
      permissions: [...base.user.permissions, 'purchases.manage', 'cost.view', 'inventory.adjust'],
    },
  };
}

function open() {
  let suppliers: SupplierListResponse = { items: [], totalOwedMinor: 0, baseCurrency: 'SYP' };
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': () => ({ status: 200, body: owner() }),
    'GET /v1/suppliers': () => ({ status: 200, body: suppliers }),
    'GET /v1/purchases': () => ({ status: 200, body: { items: [], baseCurrency: 'SYP' } }),
    'POST /v1/suppliers': (r: MockRequest) => {
      const s = {
        id: 's-1',
        name: (r.body as { name: string }).name,
        phone: null,
        notes: null,
        balanceMinor: 0,
        archived: false,
      };
      suppliers = { ...suppliers, items: [s] };
      return { status: 201, body: s };
    },
    [`GET ${productsPath({ q: 'قميص' })}`]: () => ({
      status: 200,
      body: { items: [{ id: 'p-2', nameAr: 'قميص كتان', type: 'stock' }], nextCursor: null },
    }),
    'GET /v1/products/p-2': () => ({
      status: 200,
      body: {
        id: 'p-2',
        nameAr: 'قميص كتان',
        variants: [
          ['M', 'أبيض'],
          ['L', 'أبيض'],
          ['M', 'أزرق'],
        ].map(([size, colour], i) => ({
          id: `v-${size}${i}`,
          label: `${size} · ${colour}`,
          archivedAt: null,
          barcodes: [],
          attributes: [
            { name: 'المقاس', value: size },
            { name: 'اللون', value: colour },
          ],
        })),
      },
    }),
    [`GET ${productsPath({ q: 'حليب' })}`]: () => ({
      status: 200,
      body: { items: [{ id: 'p-1', nameAr: 'حليب طازج', type: 'stock' }], nextCursor: null },
    }),
    'GET /v1/products/p-1': () => ({
      status: 200,
      body: {
        id: 'p-1',
        nameAr: 'حليب طازج',
        variants: [{ id: 'v-1', label: null, archivedAt: null, barcodes: [] }],
      },
    }),
    'POST /v1/purchases': () => ({ status: 201, body: { id: 'pu-1', number: 'PUR-2026-000001' } }),
  });
  return { ...mock, ...renderApp('/purchases') };
}

describe('«المشتريات»', () => {
  it('adds a supplier, then records a purchase of an item with its quantity and cost', async () => {
    const { user, requestsTo } = open();
    expect(await screen.findByRole('heading', { name: 'المشتريات والموردون', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('أضف مورداً أولاً، ثم سجّل فواتير الشراء منه.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'مورد جديد' }));
    await user.type(screen.getByLabelText('اسم المورد'), 'مؤسسة الفرات');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('أُضيف المورد.')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'فاتورة شراء' }));
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'حليب');
    await user.click(await screen.findByRole('button', { name: 'حليب طازج' }));
    await user.type(await screen.findByLabelText('كمية حليب طازج'), '12');
    await user.type(screen.getByLabelText('كلفة حليب طازج'), '24000');
    await user.click(screen.getByRole('button', { name: 'سجّل الفاتورة' }));
    expect(
      await screen.findByText('سُجّلت الفاتورة PUR-2026-000001 ودخلت البضاعة المخزون.'),
    ).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/purchases')[0]?.body).toMatchObject({
      supplierId: 's-1',
      payment: 'credit',
      lines: [{ variantId: 'v-1', qty: 12_000, costMinor: 2_400_000 }],
    });
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });
});

describe('typed amounts', () => {
  it('reads quantities in thousandths and pounds in qirsh, Arabic digits too', () => {
    expect(qtyOf('12')).toBe(12_000);
    expect(qtyOf('1.25')).toBe(1_250);
    expect(qtyOf('١٢')).toBe(12_000);
    expect(qtyOf('-1')).toBeNull();
    expect(moneyOf('24,000')).toBe(2_400_000);
    expect(moneyOf('9.5')).toBe(950);
    expect(moneyOf('abc')).toBeNull();
  });

  it('takes a model in sizes and colours as a grid, one cost per piece, then saves every piece', async () => {
    const { user, requestsTo } = open();
    await user.click(await screen.findByRole('button', { name: 'مورد جديد' }));
    await user.type(screen.getByLabelText('اسم المورد'), 'معمل');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    await user.click(await screen.findByRole('button', { name: 'فاتورة شراء' }));
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'قميص');
    await user.click(await screen.findByRole('button', { name: 'قميص كتان' }));
    const grid = await screen.findByRole('group', { name: 'جدول قميص كتان' });
    // L in blue was never made: no cell
    expect(within(grid).getAllByRole('textbox', { name: /كمية/ })).toHaveLength(3);
    await user.type(within(grid).getByLabelText('كمية M · أبيض'), '6');
    await user.type(within(grid).getByLabelText('كمية L · أبيض'), '4');
    await user.type(within(grid).getByLabelText('كلفة القطعة الواحدة'), '12500');
    await user.click(within(grid).getByRole('button', { name: 'أضف 10 قطعة' }));
    expect(screen.getByLabelText('كمية قميص كتان M · أبيض')).toHaveValue('6');
    expect(screen.getByLabelText('كلفة قميص كتان L · أبيض')).toHaveValue('50,000');
    await user.click(screen.getByRole('button', { name: 'سجّل الفاتورة' }));
    await screen.findByText(/سُجّلت الفاتورة/);
    expect(requestsTo('POST', '/v1/purchases')[0]?.body).toMatchObject({
      lines: [
        { variantId: 'v-M0', qty: 6000, costMinor: 7_500_000 },
        { variantId: 'v-L1', qty: 4000, costMinor: 5_000_000 },
      ],
    });
  });
});

describe('size runs («طقم مقاسات»)', () => {
  it('fills every colour with the run, sizes in the grid’s order, and a run never adds a missing piece', async () => {
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: 'مورد جديد' }));
    await user.type(screen.getByLabelText('اسم المورد'), 'معمل');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    await user.click(await screen.findByRole('button', { name: 'فاتورة شراء' }));
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'قميص');
    await user.click(await screen.findByRole('button', { name: 'قميص كتان' }));
    const grid = await screen.findByRole('group', { name: 'جدول قميص كتان' });
    await user.clear(within(grid).getByLabelText('عدد الأطقم لكل لون'));
    await user.type(within(grid).getByLabelText('عدد الأطقم لكل لون'), '2');
    await user.click(within(grid).getByRole('button', { name: 'طقم 1-2-2-1' }));
    // Sizes M, L: the run's 1 and 2, twice; the blue L was never made
    expect(within(grid).getByLabelText('كمية M · أبيض')).toHaveValue('2');
    expect(within(grid).getByLabelText('كمية L · أبيض')).toHaveValue('4');
    expect(within(grid).getByLabelText('كمية M · أزرق')).toHaveValue('2');
  });
});

describe('size run quantities and their text', () => {
  const piece = (size: string, colour: string): ProductDetail['variants'][number] =>
    ({
      id: `${size}-${colour}`,
      archivedAt: null,
      label: `${size} · ${colour}`,
      attributes: [
        { name: 'المقاس', value: size },
        { name: 'اللون', value: colour },
      ],
    }) as ProductDetail['variants'][number];

  it('puts 1-2-2-1 on S-M-L-XL of each colour, and follows the sizes when they are the columns', () => {
    const rows = ['S', 'M', 'L', 'XL'].flatMap((s) => ['أبيض', 'أسود'].map((c) => piece(s, c)));
    expect(sizeRunQuantities(rows, [1, 2, 2, 1], 1)).toEqual({
      'S-أبيض': '1',
      'S-أسود': '1',
      'M-أبيض': '2',
      'M-أسود': '2',
      'L-أبيض': '2',
      'L-أسود': '2',
      'XL-أبيض': '1',
      'XL-أسود': '1',
    });
    // Colour first, size second: the sizes are the columns
    const flipped = rows.map((v) => ({ ...v, attributes: [...v.attributes].reverse() }));
    expect(sizeRunQuantities(flipped, [1, 0, 3], 2)).toEqual({
      'S-أبيض': '2',
      'S-أسود': '2',
      'L-أبيض': '6',
      'L-أسود': '6',
    });
  });

  it('reads «1-2-2-1» with Arabic digits and refuses what is no list of counts', () => {
    expect(parseRunCounts('1-2-2-1')).toEqual([1, 2, 2, 1]);
    expect(parseRunCounts('١ - ٢ - ٢ - ١')).toEqual([1, 2, 2, 1]);
    expect(parseRunCounts('0-0')).toBeNull();
    expect(parseRunCounts('a-b')).toBeNull();
    expect(parseRunCounts('')).toBeNull();
    expect(parseRunCounts('1-2-3-4-5-6-7-8-9-1-2-3-4')).toBeNull();
  });
});

describe('payments and duplicate suppliers', () => {
  function openWithSupplier() {
    const suppliers: SupplierListResponse = {
      items: [
        {
          id: 's-1',
          name: 'شركة النور',
          phone: '0933123456',
          notes: null,
          balanceMinor: 100_000,
          archived: false,
        },
      ],
      totalOwedMinor: 100_000,
      baseCurrency: 'SYP',
    };
    const mock = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/suppliers': () => ({ status: 200, body: suppliers }),
      'GET /v1/purchases': () => ({ status: 200, body: { items: [], baseCurrency: 'SYP' } }),
      'POST /v1/supplier-payments': () => ({
        status: 201,
        body: {
          id: 'sp-1',
          number: 'PAY-1',
          supplierId: 's-1',
          date: '2026-10-30',
          amountMinor: 1,
          method: 'cash',
        },
      }),
      'POST /v1/suppliers': () => ({
        status: 201,
        body: { id: 's-2', name: 'شركة النور', phone: null, notes: null, balanceMinor: 0, archived: false },
      }),
    });
    return { ...mock, ...renderApp('/purchases') };
  }

  it('asks to confirm a payment above what is owed and sends it as an advance', async () => {
    const { user, requestsTo } = openWithSupplier();
    await user.click(await screen.findByRole('button', { name: 'دفعة لمورد' }));
    await user.type(screen.getByLabelText('المبلغ بالليرة'), '5000');
    expect(await screen.findByText(/أكبر مما للمورد عليك/)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'سجّل الدفعة' });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('switch', { name: 'نعم، هذه دفعة مقدّمة' }));
    await user.click(submit);
    expect(await screen.findByText('سُجّل سند الدفع PAY-1.')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/supplier-payments')[0]?.body).toMatchObject({
      amountMinor: 500_000,
      advance: true,
    });
  });

  it('pays by cheque with its bank, number and due date, out of the bank', async () => {
    const { user, requestsTo } = openWithSupplier();
    await user.click(await screen.findByRole('button', { name: 'دفعة لمورد' }));
    await user.type(screen.getByLabelText('المبلغ بالليرة'), '10');
    await user.click(screen.getByRole('radio', { name: 'بشيك' }));
    const submit = screen.getByRole('button', { name: 'سجّل الدفعة' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('البنك'), 'بنك سورية');
    await user.type(screen.getByLabelText('رقم الشيك'), '4410');
    await user.click(submit);
    expect(await screen.findByText('سُجّل سند الدفع PAY-1.')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/supplier-payments')[0]?.body).toMatchObject({
      method: 'bank',
      cheque: { bank: 'بنك سورية', number: '4410' },
    });
  });

  it('refuses an absurd amount with a message and warns about a supplier with the same name', async () => {
    const { user, requestsTo } = openWithSupplier();
    await user.click(await screen.findByRole('button', { name: 'دفعة لمورد' }));
    await user.type(screen.getByLabelText('المبلغ بالليرة'), '88299999999999999');
    expect(await screen.findByText(/كبير جداً/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'سجّل الدفعة' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'إلغاء' }));

    await user.click(screen.getByRole('button', { name: 'مورد جديد' }));
    await user.type(screen.getByLabelText('اسم المورد'), 'شركة النور');
    expect(await screen.findByText(/يوجد مورد بالاسم نفسه/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'افتح المورد' })).toHaveAttribute(
      'href',
      '/suppliers/s-1/statement',
    );
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(requestsTo('POST', '/v1/suppliers')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'أضِفه رغم ذلك' }));
    expect(await screen.findByText('أُضيف المورد.')).toBeInTheDocument();
  });
});
