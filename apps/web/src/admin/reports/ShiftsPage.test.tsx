import { fireEvent, screen, within } from '@testing-library/react';
import { stripBidiControls } from '@serva/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockFetch, type MockReply } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { MANAGER_KEYS, meWith, NOW, OWNER_KEYS, shiftReport, shiftSummary, TODAY } from '../../test/reports';
import type { AccessKey } from './access';

const text = (element: Element) => stripBidiControls(element.textContent ?? '');

function signIn(
  keys: readonly AccessKey[],
  routes: Record<string, MockReply | (() => MockReply)>,
  path: string,
) {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: meWith(keys) },
    ...routes,
  });
  return { ...mock, ...renderApp(path) };
}

const open = shiftSummary({
  id: 'shift-2',
  number: 'SFT-001-001-0000232',
  deviceCode: '001',
  openedBy: { id: 'u-2', fullName: 'لينا' },
  openedAt: '2026-10-31T06:15:00.000Z',
  closedAt: null,
  status: 'open',
  salesCount: 12,
  salesTotalMinor: 980_000,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('«الورديات»', () => {
  it("lists the day's shifts with their device, who opened them, times and sales", async () => {
    signIn(
      MANAGER_KEYS,
      { [`GET /v1/shifts?date=${TODAY}`]: { status: 200, body: { items: [shiftSummary(), open] } } },
      '/shifts',
    );

    const table = await screen.findByRole('table', { name: 'ورديات 31 تشرين الأول 2026' });
    await within(table).findByText('SFT-001-002-0000231');
    const rows = within(table).getAllByRole('row').map(text);
    expect(rows).toEqual([
      'الورديةالكاشيرالفتحالإغلاقالفواتيرإجمالي المبيعاتالحالة',
      'SFT-001-002-0000231جهاز 002سامر8:00 ص4:05 م138412,800 ل.سمغلقة',
      'SFT-001-001-0000232جهاز 001لينا9:15 ص—129,800 ل.س● مفتوحة',
      'المجموع150422,600 ل.س',
    ]);
    expect(within(table).getByRole('link', { name: 'SFT-001-002-0000231' })).toHaveAttribute(
      'href',
      '/shifts/shift-1',
    );
    expect(screen.getByRole('link', { name: 'الورديات' })).toHaveAttribute('aria-current', 'page');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('shows the drawer expected, counted and difference of each shift to whoever sees the difference', async () => {
    signIn(
      OWNER_KEYS,
      {
        [`GET /v1/shifts?date=${TODAY}`]: {
          status: 200,
          body: {
            items: [
              shiftSummary({
                cash: [
                  {
                    currency: 'SYP',
                    expectedMinor: 15_270_000,
                    countedMinor: 15_120_000,
                    differenceMinor: -150_000,
                  },
                  { currency: 'USD', expectedMinor: 46_000, countedMinor: 46_000, differenceMinor: 0 },
                ],
              }),
            ],
          },
        },
      },
      '/shifts',
    );

    const table = await screen.findByRole('table', { name: 'ورديات 31 تشرين الأول 2026' });
    await within(table).findByText('عجز');
    const row = within(table).getAllByRole('row').map(text)[1] ?? '';
    // The list says only the difference, as a badge (the close report has the expected and the counted)
    expect(row).toContain('عجز 1,500 ل.س');
    expect(row).not.toContain('مطابق');
  });

  it('asks once for the list: no report per shift, and the drawer comes with the list', async () => {
    const { requestsTo, requests } = signIn(
      OWNER_KEYS,
      {
        [`GET /v1/shifts?date=${TODAY}`]: {
          status: 200,
          body: {
            items: [
              shiftSummary({
                cash: [{ currency: 'SYP', expectedMinor: 100, countedMinor: 100, differenceMinor: 0 }],
              }),
              open,
            ],
          },
        },
      },
      '/shifts',
    );
    await screen.findByRole('table', { name: 'ورديات 31 تشرين الأول 2026' });
    expect(requestsTo('GET', `/v1/shifts?date=${TODAY}`)).toHaveLength(1);
    expect(requests.some((r) => /\/v1\/shifts\/[^?]/.test(r.path))).toBe(false);
  });

  it('adds up each cashier’s shortage and surplus per currency over the closed shifts of the list', async () => {
    const byAbeer = (id: string, differenceMinor: number) =>
      shiftSummary({
        id,
        number: `SFT-${id}`,
        openedBy: { id: 'u-1', fullName: 'سامر' },
        cash: [
          { currency: 'SYP', expectedMinor: 1_000, countedMinor: 1_000 + differenceMinor, differenceMinor },
        ],
      });
    signIn(
      OWNER_KEYS,
      {
        [`GET /v1/shifts?date=${TODAY}`]: {
          status: 200,
          body: {
            items: [
              byAbeer('a', -2_000_000),
              byAbeer('b', 500_000),
              shiftSummary({
                id: 'c',
                number: 'SFT-c',
                openedBy: { id: 'u-2', fullName: 'لينا' },
                cash: [{ currency: 'SYP', expectedMinor: 1, countedMinor: 1, differenceMinor: 0 }],
              }),
              {
                ...open,
                cash: [{ currency: 'SYP', expectedMinor: 5, countedMinor: null, differenceMinor: null }],
              },
            ],
          },
        },
      },
      '/shifts',
    );
    const panel = await screen.findByRole('region', { name: 'فروق الصندوق لكل كاشير' });
    const cells = within(panel)
      .getAllByText(/ورديتان مغلقة|وردية واحدة مغلقة/, { exact: false })
      .map((cell) => text(cell.closest('.sx-cs')!));
    expect(cells).toEqual([
      'سسامرعجز 15,000 ل.سورديتان مغلقة · العجز 20,000 ل.س · الزيادة 5,000 ل.س',
      'للينالا فرقوردية واحدة مغلقة',
    ]);
  });

  it('hides the cashier shortage from whoever may not see the difference', async () => {
    signIn(
      MANAGER_KEYS,
      { [`GET /v1/shifts?date=${TODAY}`]: { status: 200, body: { items: [shiftSummary()] } } },
      '/shifts',
    );
    await screen.findByText('SFT-001-002-0000231');
    expect(screen.queryByText('فروق الصندوق لكل كاشير')).not.toBeInTheDocument();
  });

  it('shows a failed list as an error, not as empty cells', async () => {
    signIn(
      OWNER_KEYS,
      { [`GET /v1/shifts?date=${TODAY}`]: apiError(500, 'internal', 'حدث خطأ غير متوقع. حاول مجدداً.') },
      '/shifts',
    );
    expect(await screen.findByText('حدث خطأ غير متوقع. حاول مجدداً.')).toBeInTheDocument();
  });

  it('shows a week or a month as one range, asking the server for from and to', async () => {
    const { requestsTo } = signIn(
      MANAGER_KEYS,
      {
        [`GET /v1/shifts?date=${TODAY}`]: { status: 200, body: { items: [] } },
        'GET /v1/shifts?from=2026-10-01&to=2026-10-31': { status: 200, body: { items: [open] } },
      },
      '/shifts',
    );
    await screen.findByText('لا ورديات في هذا اليوم.');
    fireEvent.click(screen.getByRole('radio', { name: 'هالشهر' }));
    expect(await screen.findByText('SFT-001-001-0000232')).toBeInTheDocument();
    expect(requestsTo('GET', '/v1/shifts?from=2026-10-01&to=2026-10-31')).toHaveLength(1);
  });

  it('says a bounded list was cut at 500', async () => {
    signIn(
      MANAGER_KEYS,
      {
        [`GET /v1/shifts?date=${TODAY}`]: { status: 200, body: { items: [open], truncated: true } },
      },
      '/shifts',
    );
    expect(await screen.findByText(/هذه أول 500 وردية فقط/)).toBeInTheDocument();
  });

  it('shows a half unit in the total as the close report does, never rounded up', async () => {
    signIn(
      MANAGER_KEYS,
      {
        [`GET /v1/shifts?date=${TODAY}`]: {
          status: 200,
          body: { items: [shiftSummary({ salesTotalMinor: 2_837_250 })] },
        },
      },
      '/shifts',
    );
    const table = await screen.findByRole('table', { name: 'ورديات 31 تشرين الأول 2026' });
    await within(table).findByText('SFT-001-002-0000231');
    expect(text(within(table).getAllByRole('row')[1]!)).toContain('28,372.50 ل.س');
  });

  it('says in one quiet line that shifts stayed open over a day, linking to the list of them', async () => {
    const stale = shiftSummary({
      id: 'old-1',
      number: 'SFT-001-001-0000100',
      deviceCode: '007',
      openedBy: { id: 'u-3', fullName: 'هبة' },
      openedAt: '2026-10-28T06:15:00.000Z',
      closedAt: null,
      status: 'open',
    });
    signIn(
      MANAGER_KEYS,
      {
        [`GET /v1/shifts?date=${TODAY}`]: { status: 200, body: { items: [open] } },
        'GET /v1/shifts?status=open': { status: 200, body: { items: [stale, open] } },
      },
      '/shifts',
    );
    const link = await screen.findByRole('link', { name: 'اعرضها' });
    expect(link).toHaveAttribute('href', '/shifts?open=1');
    expect(text(link.parentElement!)).toBe('فيه 1 ورديات مفتوحة من أكثر من يوم. اعرضها');
    expect(screen.queryByRole('region', { name: /ورديات مفتوحة/ })).not.toBeInTheDocument();
  });

  it('lists the open shifts of any day with their age when asked, and says nothing closes them from here', async () => {
    const stale = shiftSummary({
      id: 'old-1',
      number: 'SFT-001-001-0000100',
      deviceCode: '007',
      openedBy: { id: 'u-3', fullName: 'هبة' },
      openedAt: '2026-10-28T06:15:00.000Z',
      closedAt: null,
      status: 'open',
    });
    signIn(
      MANAGER_KEYS,
      { 'GET /v1/shifts?status=open': { status: 200, body: { items: [stale] } } },
      '/shifts?open=1',
    );
    const table = await screen.findByRole('table', { name: 'الورديات المفتوحة' }, { timeout: 4000 });
    const row = text(within(table).getAllByRole('row')[1]!);
    expect(row).toContain('SFT-001-001-0000100');
    expect(row).toContain('هبة');
    expect(row).toContain('منذ 3 أيام');
    expect(await screen.findByText(/لا يوجد إغلاق من لوحة الإدارة/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ورديات اليوم' })).toBeInTheDocument();
  });

  it('says when there is no shift that day, and shows a failed load with a retry', async () => {
    let calls = 0;
    signIn(
      MANAGER_KEYS,
      {
        [`GET /v1/shifts?date=${TODAY}`]: () => {
          calls += 1;
          return calls === 1
            ? apiError(500, 'internal', 'حدث خطأ غير متوقع. حاول مجدداً.')
            : { status: 200, body: { items: [] } };
        },
      },
      '/shifts',
    );

    expect(await screen.findByText('حدث خطأ غير متوقع. حاول مجدداً.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'حاول مرة أخرى' }));
    expect(await screen.findByText('لا ورديات في هذا اليوم.')).toBeInTheDocument();
  });

  it('filters by branch', async () => {
    const { requestsTo } = signIn(
      MANAGER_KEYS,
      {
        [`GET /v1/shifts?date=${TODAY}`]: { status: 200, body: { items: [] } },
        [`GET /v1/shifts?branchId=branch-2&date=${TODAY}`]: { status: 200, body: { items: [open] } },
      },
      '/shifts',
    );
    await screen.findByText('لا ورديات في هذا اليوم.');
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: 'branch-2' } });

    expect(await screen.findByText('SFT-001-001-0000232')).toBeInTheDocument();
    expect(requestsTo('GET', `/v1/shifts?branchId=branch-2&date=${TODAY}`)).toHaveLength(1);
  });
});

describe('the shift close report', () => {
  it('shows the cash per currency with the difference, the methods and the approved movements', async () => {
    signIn(OWNER_KEYS, { 'GET /v1/shifts/shift-1': { status: 200, body: shiftReport() } }, '/shifts/shift-1');

    expect(await screen.findByRole('heading', { name: 'تقرير إغلاق الوردية', level: 1 })).toBeInTheDocument();
    const cashRegion = screen.getByRole('region', { name: 'النقد لكل عملة' });
    // The terms that did not happen fold away behind one line; the rest read as before
    const cash = within(cashRegion).getAllByRole('row');
    expect(cash.map(text)).toEqual([
      'البندليرةدولار',
      'الرصيد الافتتاحي25,000 ل.س50.00 $',
      'المبيعات نقداً268,400 ل.س410.00 $',
      'الباقي المعطى−1,200 ل.س—',
      'الإيداع في الدرج12,000 ل.س—',
      'السحب من الدرج−1,500 ل.س—',
      'إلى الخزنة−150,000 ل.س—',
      'النقد المتوقع152,700 ل.س460.00 $',
      'المعدود151,200 ل.س460.00 $',
      'الفرقعجز 1,500 ل.سلا فرق',
    ]);
    fireEvent.click(within(cashRegion).getByRole('button', { name: /اعرض 2 صفوف صفرية/ }));
    expect(within(cashRegion).getAllByRole('row').map(text)).toContain('المرتجعات نقداً——');
    expect(within(cashRegion).getAllByRole('row').map(text)).toContain(
      'دفعات الزبائن نقداً (وعربون التأجير)——',
    );
    // The result comes first, above the shift's details: the shortage, then what was counted and expected
    const result = screen.getByRole('region', { name: 'نتيجة الصندوق' });
    expect(text(result)).toContain('عجز 1,500 ل.س');
    expect(text(result)).toContain('المعدود فعلاً151,200 ل.س');
    expect(text(result)).toContain('المتوقع في الدرج152,700 ل.س');
    expect(text(result)).toContain('مطابق');
    expect(text(result)).toContain('فيه عجز بالصندوق: ليرة 1,500 ل.س');
    expect(
      result.compareDocumentPosition(screen.getByRole('region', { name: 'النقد لكل عملة' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(cashRegion).getAllByText('عجز')[0]).toHaveClass('text-danger-ink');
    expect(screen.getByText(/عربون التأجير المقبوض نقداً يُحسب هنا/)).toBeInTheDocument();
    expect(screen.getByText(/رُدّ العربون في وردية غير التي قُبض فيها/)).toBeInTheDocument();

    const methods = within(screen.getByRole('region', { name: 'المبيعات حسب الطريقة والعملة' }));
    expect(methods.getAllByRole('listitem').map(text)).toEqual([
      'نقداً · ليرة120 دفعة268,400 ل.س85%',
      'نقداً · دولار9 دفعة410.00 $100%',
      'بطاقة9 دفعة46,200 ل.س15%',
    ]);

    const moves = within(screen.getByRole('region', { name: 'الإيداع والسحب من الدرج' })).getAllByRole('row');
    expect(moves.map(text)).toEqual([
      'الحركةالسببالمبلغوافق عليهالوقت',
      'إيداع في الدرجفكّة من الخزنة12,000 ل.سخالد العلي10:15 ص',
      'سحب من الدرجثلج ومواد تنظيف1,500 ل.س—12:40 م',
    ]);
    expect(screen.getByText('31 تشرين الأول 2026، 8:00 ص')).toBeInTheDocument();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('hides the expected cash and the difference from whoever may not see them', async () => {
    const report = shiftReport();
    const hidden = {
      ...report,
      byCurrency: report.byCurrency.map((row) => ({ ...row, expectedMinor: null, differenceMinor: null })),
    };
    signIn(MANAGER_KEYS, { 'GET /v1/shifts/shift-1': { status: 200, body: hidden } }, '/shifts/shift-1');

    const region = await screen.findByRole('region', { name: 'النقد لكل عملة' });
    expect(within(region).queryByText('النقد المتوقع')).not.toBeInTheDocument();
    expect(within(region).queryByText('الفرق')).not.toBeInTheDocument();
    expect(within(region).getByText('المعدود')).toBeInTheDocument();
    expect(region).toHaveTextContent('النقد المتوقع والفرق يظهران لمن يملك صلاحية رؤية فرق الصندوق.');
  });

  it('keeps the difference hidden even if a server sent it to a key holder it should not', async () => {
    signIn(
      MANAGER_KEYS,
      { 'GET /v1/shifts/shift-1': { status: 200, body: shiftReport() } },
      '/shifts/shift-1',
    );

    const region = await screen.findByRole('region', { name: 'النقد لكل عملة' });
    expect(within(region).queryByText('الفرق')).not.toBeInTheDocument();
  });

  it('reads an open shift as an X report with nothing counted yet', async () => {
    const report = shiftReport({
      ...open,
      byCurrency: shiftReport().byCurrency.map((row) => ({
        ...row,
        countedMinor: null,
        differenceMinor: null,
      })),
      movements: [],
    });
    signIn(OWNER_KEYS, { 'GET /v1/shifts/shift-2': { status: 200, body: report } }, '/shifts/shift-2');

    expect(await screen.findByRole('heading', { name: 'تقرير الوردية', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('ما زالت مفتوحة')).toBeInTheDocument();
    const counted = screen.getByRole('row', { name: /^المعدود/ });
    expect(text(counted)).toBe('المعدود——');
    expect(screen.getByText('لا إيداع ولا سحب في هذه الوردية.')).toBeInTheDocument();
  });

  it('prints the Z report on 80 mm and the report on A4', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    signIn(OWNER_KEYS, { 'GET /v1/shifts/shift-1': { status: 200, body: shiftReport() } }, '/shifts/shift-1');
    await screen.findByRole('heading', { name: 'تقرير إغلاق الوردية', level: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'اطبع 80 مم' }));
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    const receipt = document.querySelector('[data-print-sheet="80mm"]');
    expect(receipt).not.toBeNull();
    expect(text(receipt!)).toContain('تقرير Z');
    expect(text(receipt!)).toContain('SFT-001-002-0000231');
    expect(text(receipt!)).toContain('الفرقعجز 1,500 ل.س');
    expect(text(receipt!)).toContain('إيداع في الدرج: فكّة من الخزنة12,000 ل.س');
    expect(receipt!.querySelector('style')?.textContent).toContain('80mm');

    fireEvent.click(screen.getByRole('button', { name: 'اطبع A4' }));
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(2));
    const a4 = document.querySelector('[data-print-sheet="A4"]');
    expect(a4).not.toBeNull();
    expect(document.querySelector('[data-print-sheet="80mm"]')).toBeNull();
    expect(text(a4!)).toContain('توقيع المدير');
    expect(text(a4!)).toContain('وافق: خالد العلي');
  });

  it('says a missing or mistyped shift is not there, with no retry and a way back to the list', async () => {
    signIn(
      OWNER_KEYS,
      { 'GET /v1/shifts/nope': apiError(404, 'not_found', 'هذه الوردية غير موجودة.') },
      '/shifts/nope',
    );

    expect(await screen.findByText('الوردية غير موجودة')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /أعد المحاولة|حاول مرة أخرى/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'كل الورديات' })).toHaveAttribute('href', '/shifts');
  });

  it('still offers a retry when the report fails for another reason', async () => {
    signIn(
      OWNER_KEYS,
      { 'GET /v1/shifts/shift-9': apiError(500, 'internal', 'حدث خطأ غير متوقع. حاول مجدداً.') },
      '/shifts/shift-9',
    );
    expect(await screen.findByText('حدث خطأ غير متوقع. حاول مجدداً.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'أعد المحاولة' })).toBeInTheDocument();
  });

  it('keeps the page inside a phone: the sections sit in a column that may shrink', async () => {
    signIn(OWNER_KEYS, { 'GET /v1/shifts/shift-1': { status: 200, body: shiftReport() } }, '/shifts/shift-1');
    const methods = await screen.findByRole('region', { name: 'المبيعات حسب الطريقة والعملة' });
    expect(methods.parentElement).toHaveClass('sx-grid');
  });
});
