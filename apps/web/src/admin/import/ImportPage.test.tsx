import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ImportInput, ImportResponse, ImportRowResult, Permission } from '@serva/core';
import { catalogMe } from '../../test/catalog';
import { mockFetch, type MockReply, type MockRequest } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import './ImportPage';

const CSV = [
  'اسم الصنف,الباركود,سعر البيع,الكمية',
  'شاي الربيع,6281234500012,45000,24',
  'سكر,6281234500029,abc,',
  'قهوة,6281234500012,30000,',
].join('\r\n');

/** The server’s answer, made from the rows it was sent: «سكر» is refused, the rest are new. */
function answer(request: MockRequest): MockReply {
  const input = request.body as ImportInput;
  const results: ImportRowResult[] = input.rows.map((row) =>
    row.values.name === 'سكر'
      ? {
          line: row.line,
          status: 'error',
          errors: [{ field: 'price', message: 'سعر البيع ليس رقماً' }],
          notes: [],
        }
      : { line: row.line, status: 'create', errors: [], notes: [] },
  );
  const totals = { create: 0, update: 0, skip: 0, error: 0 };
  for (const r of results) totals[r.status] += 1;
  const body: ImportResponse = { type: input.type, mode: input.mode, results, totals };
  return { status: 200, body };
}

function open(
  permissions: readonly Permission[] = ['catalog.manage', 'customers.manage', 'purchases.manage'],
  path = '/import',
) {
  const routes = {
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: catalogMe([...permissions]) },
    'POST /v1/import': answer,
  };
  const mock = mockFetch(routes);
  return { ...mock, ...renderApp(path) };
}

const upload = async (user: ReturnType<typeof renderApp>['user'], text = CSV, name = 'منتجات.csv') => {
  const input = await screen.findByLabelText('ملف الاستيراد');
  await user.upload(input, new File([text], name, { type: 'text/csv' }));
};

describe('«استيراد البيانات»', () => {
  it('guesses the columns, checks the whole file first, then imports and reports the refused row', async () => {
    const { user, requestsTo } = open();
    await screen.findByRole('heading', { name: 'استيراد البيانات' });
    await upload(user);

    // Step 2: the columns were guessed from the headers
    await screen.findByRole('heading', { name: 'أعمدة الملف' });
    expect(screen.getByLabelText('حقل العمود اسم الصنف')).toHaveValue('name');
    expect(screen.getByLabelText('حقل العمود الباركود')).toHaveValue('barcode');
    expect(screen.getByLabelText('حقل العمود سعر البيع')).toHaveValue('price');
    expect(screen.getByLabelText('حقل العمود الكمية')).toHaveValue('quantity');
    await user.click(screen.getByRole('button', { name: 'التالي: راجع الملف' }));

    // Step 3: nothing is sent until the check is asked for
    expect(requestsTo('POST', '/v1/import')).toHaveLength(0);
    await user.click(await screen.findByRole('button', { name: 'افحص الملف' }));
    await screen.findByRole('heading', { name: 'ما سيحدث عند الاستيراد' });

    const checks = requestsTo('POST', '/v1/import');
    expect(checks).toHaveLength(1);
    expect(checks[0]!.body).toMatchObject({ type: 'products', mode: 'dry_run', existing: 'skip' });
    // The third row repeats the first row’s barcode: it is not sent, it is reported as a repeat
    const sent = (checks[0]!.body as ImportInput).rows;
    expect(sent.map((r) => r.line)).toEqual([2, 3]);
    expect(sent[0]!.values).toEqual({
      name: 'شاي الربيع',
      barcode: '6281234500012',
      price: '45000',
      quantity: '24',
    });

    const table = screen.getByRole('table', { name: 'الصفوف التي فيها أخطاء' });
    expect(within(table).getByText('سعر البيع: سعر البيع ليس رقماً')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'نزّل ملف الأخطاء' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ابدأ الاستيراد' }));
    await screen.findByText(/انتهى الاستيراد/);
    const all = requestsTo('POST', '/v1/import');
    expect(all).toHaveLength(2);
    expect(all[1]!.body).toMatchObject({ mode: 'commit' });
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('will not go on while a required field has no column', async () => {
    const { user } = open();
    await upload(user, 'الكمية,السعر\r\n3,500\r\n');
    await screen.findByRole('heading', { name: 'أعمدة الملف' });
    expect(screen.getByText(/اربط الحقول المطلوبة: اسم المنتج/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'التالي: راجع الملف' })).toBeDisabled();
    // Pointing a column at the name field clears it
    await user.selectOptions(screen.getByLabelText('حقل العمود السعر'), 'name');
    expect(screen.getByRole('button', { name: 'التالي: راجع الملف' })).toBeEnabled();
  });

  it('remembers the mapping of a type for the next file', async () => {
    const first = open();
    await upload(first.user, 'العمود الأول,الثاني\r\nشاي,500\r\n');
    await screen.findByRole('heading', { name: 'أعمدة الملف' });
    await first.user.selectOptions(screen.getByLabelText('حقل العمود العمود الأول'), 'name');
    await first.user.selectOptions(screen.getByLabelText('حقل العمود الثاني'), 'price');
    await first.user.click(screen.getByRole('button', { name: 'التالي: راجع الملف' }));
    await screen.findByRole('button', { name: 'افحص الملف' });

    // A new file with the same headers starts from what was chosen
    await first.user.click(screen.getByRole('button', { name: 'رجوع إلى الأعمدة' }));
    await first.user.click(screen.getByRole('button', { name: 'غيّر الملف' }));
    await upload(first.user, 'العمود الأول,الثاني\r\nسكر,300\r\n');
    await screen.findByRole('heading', { name: 'أعمدة الملف' });
    expect(screen.getByLabelText('حقل العمود العمود الأول')).toHaveValue('name');
    expect(screen.getByLabelText('حقل العمود الثاني')).toHaveValue('price');
  });

  it('says what is wrong with a file in Arabic', async () => {
    const { user } = open();
    await upload(user, 'x', 'قديم.xls');
    expect(await screen.findByText(/صيغة xls القديمة غير مدعومة/)).toBeInTheDocument();
    expect(screen.getByLabelText('ملف الاستيراد')).toBeInTheDocument();
  });

  it('offers only the types the user may import, and opens the one asked for', async () => {
    open(['customers.manage'], '/import?type=customers');
    await screen.findByRole('heading', { name: 'استيراد البيانات' });
    expect(screen.getByRole('radio', { name: 'الزبائن' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'المنتجات' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'الموردون' })).not.toBeInTheDocument();
  });

  it('downloads the template of the chosen type', async () => {
    const click = vi.fn();
    const create = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    HTMLAnchorElement.prototype.click = click;
    const { user } = open();
    await screen.findByRole('heading', { name: 'استيراد البيانات' });
    await user.click(screen.getByRole('button', { name: 'نزّل القالب الجاهز' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(create).toHaveBeenCalled();
  });
});
