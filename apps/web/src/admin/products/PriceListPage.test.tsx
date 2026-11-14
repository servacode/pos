import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PriceListApplied, PriceListItem } from '@serva/core';
import { catalogMe } from '../../test/catalog';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';

const CSV = [
  'الباركود,الاسم التجاري,سعر المستهلك',
  '6291003012345,بنادول,12500',
  ',أموكسيسيلين,9000',
  '5000000000017,فيتامين ج,500',
  '1111111111111,غير معروف,700',
].join('\r\n');

const item = (
  over: Partial<PriceListItem> & Pick<PriceListItem, 'row' | 'status' | 'newMinor'>,
): PriceListItem => ({
  source: '',
  matchedBy: 'barcode',
  productId: null,
  variantId: null,
  name: null,
  currency: 'SYP',
  oldMinor: null,
  ...over,
});

/** The server's answer to the four rows above. */
const items: PriceListItem[] = [
  item({
    row: 2,
    status: 'change',
    newMinor: 1_250_000,
    oldMinor: 1_000_000,
    productId: 'p-1',
    variantId: 'v-1',
    name: 'بنادول',
  }),
  item({
    row: 3,
    status: 'change',
    newMinor: 900_000,
    oldMinor: 950_000,
    productId: 'p-2',
    variantId: 'v-2',
    name: 'أموكسيسيلين',
  }),
  item({
    row: 4,
    status: 'same',
    newMinor: 500,
    oldMinor: 500,
    productId: 'p-3',
    variantId: 'v-3',
    name: 'فيتامين ج',
  }),
  item({ row: 5, status: 'unmatched', newMinor: 700, source: '1111111111111', currency: null }),
];

function open() {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: catalogMe(['catalog.manage']) },
    'POST /v1/prices/list/preview': { status: 200, body: { items } },
    'POST /v1/prices/list/apply': (r: MockRequest) => {
      const changes = (r.body as { changes: { variantId: string; newMinor: number }[] }).changes;
      const body: PriceListApplied = {
        changed: changes.length,
        skipped: 0,
        items: changes.map((c) => ({
          productId: `p-${c.variantId.slice(2)}`,
          variantId: c.variantId,
          name: c.variantId === 'v-1' ? 'بنادول' : 'أموكسيسيلين',
          currency: 'SYP',
          oldMinor: 1,
          newMinor: c.newMinor,
        })),
      };
      return { status: 200, body };
    },
  });
  return { ...mock, ...renderApp('/price-list') };
}

const upload = async (user: ReturnType<typeof renderApp>['user'], text = CSV, name = 'نشرة.csv') => {
  await user.upload(
    await screen.findByLabelText('ملف الأسعار'),
    new File([text], name, { type: 'text/csv' }),
  );
};

describe('«تحديث الأسعار من ملف»', () => {
  it('guesses the columns, shows old and new prices, applies the chosen ones and offers the labels', async () => {
    const { user, requestsTo } = open();
    await screen.findByRole('heading', { name: 'تحديث الأسعار من ملف' });
    await upload(user);

    await screen.findByRole('heading', { name: 'أعمدة الملف' });
    expect(screen.getByLabelText('عمود الباركود')).toHaveValue('0');
    expect(screen.getByLabelText('عمود اسم الصنف')).toHaveValue('1');
    expect(screen.getByLabelText('عمود السعر الجديد')).toHaveValue('2');
    expect(requestsTo('POST', '/v1/prices/list/preview')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'طابق الصفوف' }));

    const sent = requestsTo('POST', '/v1/prices/list/preview')[0]!.body as { rows: unknown[] };
    expect(sent.rows).toHaveLength(4);
    expect(sent.rows[0]).toEqual({
      row: 2,
      barcode: '6291003012345',
      name: 'بنادول',
      generic: null,
      priceMinor: 1_250_000,
    });

    const table = await screen.findByRole('table', { name: 'الأصناف التي ستتغيّر أسعارها' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('12,500', { exact: false })).toBeInTheDocument();
    expect(within(table).getByText('10,000', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'طبّق على 2 صنفاً' })).toBeEnabled();

    // The unchanged and the unmatched rows are one tab away, with the reason
    await user.click(screen.getByRole('tab', { name: /دون تغيير/ }));
    expect(await screen.findByRole('table', { name: 'أصناف سعرها كما هو' })).toHaveTextContent('فيتامين ج');
    await user.click(screen.getByRole('tab', { name: /غير مطابقة/ }));
    const rest = await screen.findByRole('table', { name: 'صفوف لم نجد لها صنفاً' });
    expect(rest).toHaveTextContent('1111111111111');
    expect(rest).toHaveTextContent('لا صنف بهذا الباركود أو الاسم');
    await user.click(screen.getByRole('tab', { name: /ستتغيّر/ }));

    // Leave one out
    await user.click(await screen.findByRole('checkbox', { name: 'أموكسيسيلين' }));
    await user.click(screen.getByRole('button', { name: 'طبّق على 1 صنفاً' }));

    const applied = requestsTo('POST', '/v1/prices/list/apply');
    expect(applied).toHaveLength(1);
    expect(applied[0]!.body).toEqual({
      fileName: 'نشرة.csv',
      changes: [{ variantId: 'v-1', newMinor: 1_250_000 }],
    });
    await screen.findByText(/تغيّر سعر 1 صنفاً/);
    await screen.findByRole('heading', { name: 'تغيّر سعرها: اطبع ملصقاتها' });
    expect(screen.getByRole('link', { name: 'اطبع ملصقات الأسعار الجديدة' })).toHaveAttribute(
      'href',
      '/labels?queue=1',
    );
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('selects all and none, and will not go on without a price column', async () => {
    const { user } = open();
    await upload(user, 'اسم الصنف,ملاحظة\r\nبنادول,x');
    await screen.findByRole('heading', { name: 'أعمدة الملف' });
    expect(screen.getByRole('button', { name: 'طابق الصفوف' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'ملف آخر' }));
    await upload(user);
    await user.click(await screen.findByRole('button', { name: 'طابق الصفوف' }));
    await screen.findByRole('table', { name: 'الأصناف التي ستتغيّر أسعارها' });
    await user.click(screen.getByRole('checkbox', { name: 'اختر الكل' }));
    expect(screen.getByRole('button', { name: 'طبّق على 0 صنفاً' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'اختر الكل' }));
    expect(screen.getByRole('button', { name: 'طبّق على 2 صنفاً' })).toBeEnabled();
  });

  it('says so when the file cannot be read', async () => {
    const { user } = open();
    await upload(user, 'x', 'قديم.xls');
    await screen.findByText(/صيغة xls القديمة غير مدعومة/);
  });
});
