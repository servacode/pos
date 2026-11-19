import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PeriodCloseState } from '@serva/core';
import { apiError, mockFetch, type MockReply } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { meWith, NOW, OWNER_KEYS } from '../../test/reports';
import type { AccessKey } from '../reports/access';

/**
 * «إقفال الفترة» (round 37, decision 17): the owner closes up to a date, sees what arrived late, and may reopen
 * with a reason. Anyone with accounting.view reads it; only period.lock closes and only period.unlock reopens.
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const OWNER: AccessKey[] = [...OWNER_KEYS, 'period.lock', 'period.unlock'];

const open = (over: Partial<PeriodCloseState> = {}): PeriodCloseState => ({
  lockedThrough: null,
  firstOpenDay: null,
  latestCloseDate: '2026-10-30',
  history: [],
  late: [],
  lateTotalMinor: 0,
  baseCurrency: 'SYP',
  checks: [{ name: 'entries_balanced', ok: true, problems: [] }],
  ...over,
});

function signIn(
  state: PeriodCloseState,
  keys: readonly AccessKey[] = OWNER,
  routes: Record<string, MockReply | (() => MockReply)> = {},
) {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: meWith(keys, { accountingMode: true }) },
    'GET /v1/period-close': { status: 200, body: state },
    ...routes,
  });
  return { ...mock, ...renderApp('/accounting/period-close') };
}

describe('«إقفال الفترة»', () => {
  it('closes up to a day, and the page then says what is closed', async () => {
    const closed = open({
      lockedThrough: '2026-09-30',
      firstOpenDay: '2026-10-01',
      history: [
        {
          id: 'e-1',
          kind: 'close',
          lockedThrough: '2026-09-30',
          previousThrough: null,
          reason: null,
          by: 'أحمد الخطيب',
          at: '2026-10-31T09:00:00Z',
        },
      ],
    });
    const { user, requestsTo } = signIn(open(), OWNER, {
      'POST /v1/period-close/close': { status: 200, body: closed },
    });
    expect(await screen.findByText('لا فترة مقفلة')).toBeInTheDocument();
    // The suggestion is the last day of the previous month
    expect(await screen.findByLabelText('أقفل حتى تاريخ')).toHaveValue('30/09/2026');
    await user.click(screen.getByRole('button', { name: 'أقفل الفترة' }));
    expect(await screen.findByText('الدفاتر مقفلة حتى 2026-09-30')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/period-close/close')[0]!.body).toEqual({ through: '2026-09-30' });
    const history = screen.getByRole('table', { name: 'سجل الإقفال' });
    expect(within(history).getByText('إقفال')).toBeInTheDocument();
    expect(within(history).getByText('أحمد الخطيب')).toBeInTheDocument();
  });

  it('will not close while the integrity check is red, and shows the problem', async () => {
    signIn(
      open({
        checks: [{ name: 'stock_movements', ok: false, problems: ['المخزون لا يطابق حركته: صنف قميص'] }],
      }),
    );
    expect(await screen.findByText('المخزون لا يطابق حركته: صنف قميص')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'أقفل الفترة' })).toBeDisabled();
  });

  it('shows the server’s refusal in plain Arabic', async () => {
    const { user } = signIn(open(), OWNER, {
      'POST /v1/period-close/close': apiError(409, 'conflict', 'الفترة مقفلة أصلاً حتى 2026-10-25.'),
    });
    await user.click(await screen.findByRole('button', { name: 'أقفل الفترة' }));
    expect(await screen.findByText('الفترة مقفلة أصلاً حتى 2026-10-25.')).toBeInTheDocument();
  });

  it('lists what arrived after the close and where it was posted', async () => {
    signIn(
      open({
        lockedThrough: '2026-10-25',
        firstOpenDay: '2026-10-26',
        lateTotalMinor: 70_000,
        late: [
          {
            entryId: 'x-1',
            number: '2026-0000012',
            entryDate: '2026-10-20',
            postingDate: '2026-10-26',
            sourceType: 'sale',
            sourceNumber: 'INV-1',
            memo: 'بيع',
            totalMinor: 70_000,
          },
        ],
      }),
    );
    const table = await screen.findByRole('table', { name: 'قيود وصلت بعد الإقفال' });
    expect(within(table).getByText('2026-10-20')).toBeInTheDocument();
    expect(within(table).getByText('2026-10-26')).toBeInTheDocument();
    expect(within(table).getByText('بيع')).toBeInTheDocument();
  });

  it('reopens with a reason; the button waits for it', async () => {
    const { user, requestsTo } = signIn(
      open({ lockedThrough: '2026-10-25', firstOpenDay: '2026-10-26' }),
      OWNER,
      { 'POST /v1/period-close/reopen': { status: 200, body: open() } },
    );
    const reopenButton = await screen.findByRole('button', { name: 'افتح' });
    expect(reopenButton).toBeDisabled();
    await user.type(screen.getByLabelText('سبب الفتح'), 'فاتورة منسية');
    expect(reopenButton).toBeEnabled();
    await user.click(reopenButton);
    expect(await screen.findByText('فُتحت كل الفترات.')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/period-close/reopen')[0]!.body).toEqual({
      through: null,
      reason: 'فاتورة منسية',
    });
  });

  it('a reader without the keys sees the state and neither button', async () => {
    signIn(open({ lockedThrough: '2026-10-25', firstOpenDay: '2026-10-26' }), OWNER_KEYS);
    expect(await screen.findByText('الدفاتر مقفلة حتى 2026-10-25')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'أقفل الفترة' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'افتح' })).not.toBeInTheDocument();
  });

  it('uses no word the owner does not use', async () => {
    signIn(open({ lockedThrough: '2026-10-25', firstOpenDay: '2026-10-26' }));
    await screen.findByText('الدفاتر مقفلة حتى 2026-10-25');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });
});
