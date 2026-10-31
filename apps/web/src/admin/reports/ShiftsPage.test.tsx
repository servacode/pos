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
      'الورديةالجهازفتحهاالفتحالإغلاقالفواتيرالمبيعات',
      'SFT-001-002-0000231002سامر8:00 ص4:05 م138412,800 ل.س',
      'SFT-001-001-0000232001لينا9:15 صمفتوحة129,800 ل.س',
      'المجموع150422,600 ل.س',
    ]);
    expect(within(table).getByRole('link', { name: 'SFT-001-002-0000231' })).toHaveAttribute(
      'href',
      '/shifts/shift-1',
    );
    expect(screen.getByRole('link', { name: 'الورديات' })).toHaveAttribute('aria-current', 'page');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
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
    const cash = within(screen.getByRole('region', { name: 'النقد لكل عملة' })).getAllByRole('row');
    expect(cash.map(text)).toEqual([
      'البندليرةدولار',
      'الرصيد الافتتاحي25,000 ل.س50.00 $',
      'المبيعات نقداً268,400 ل.س410.00 $',
      'الباقي المعطى−1,200 ل.س0.00 $',
      'الإيداع في الدرج12,000 ل.س0.00 $',
      'السحب من الدرج−1,500 ل.س0.00 $',
      'إلى الخزنة−150,000 ل.س0.00 $',
      'النقد المتوقع152,700 ل.س460.00 $',
      'المعدود151,200 ل.س460.00 $',
      'الفرقعجز 1,500 ل.سلا فرق',
    ]);
    expect(screen.getByText('عجز')).toHaveClass('text-danger-ink');

    const methods = within(screen.getByRole('region', { name: 'المبيعات حسب الطريقة والعملة' }));
    expect(methods.getAllByRole('row').map(text)).toEqual([
      'الطريقةالدفعاتالمبلغ',
      'نقداً · ليرة120268,400 ل.س',
      'نقداً · دولار9410.00 $',
      'بطاقة946,200 ل.س',
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

  it('shows a missing shift as an error with a way back to the list', async () => {
    signIn(
      OWNER_KEYS,
      { 'GET /v1/shifts/nope': apiError(404, 'not_found', 'لم نجد هذه الوردية. ارجع إلى القائمة.') },
      '/shifts/nope',
    );

    expect(await screen.findByText('لم نجد هذه الوردية. ارجع إلى القائمة.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'كل الورديات' })).toHaveAttribute('href', '/shifts');
  });
});
