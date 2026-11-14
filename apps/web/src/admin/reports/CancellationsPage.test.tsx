import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CancellationsResponse } from '@serva/core';
import { apiError, mockFetch } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { meWith, NOW, OWNER_KEYS } from '../../test/reports';
import { daysAgo } from './MerchandisePage';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const report = (): CancellationsResponse => ({
  from: daysAgo(6),
  to: daysAgo(0),
  items: [
    {
      at: '2026-10-30T18:20:00.000Z',
      table: '5',
      item: 'كباب',
      qty: 2,
      reason: 'تأخر الطلب',
      stage: 'after_prep',
      waiterName: 'نادل أول',
      approverName: 'سامي',
    },
    {
      at: '2026-10-30T17:00:00.000Z',
      table: 'VIP',
      item: 'قهوة',
      qty: 1,
      reason: 'غيّر الزبون رأيه',
      stage: 'before_prep',
      waiterName: null,
      approverName: null,
    },
  ],
});

describe('«الإلغاءات بعد المطبخ»', () => {
  it('lists each cancelled item with its reason, stage, waiter and the manager who approved', async () => {
    const path = `GET /v1/hall/cancellations?from=${daysAgo(6)}&to=${daysAgo(0)}`;
    const mock = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meWith(OWNER_KEYS) },
      [path]: { status: 200, body: report() },
      [`GET /v1/hall/cancellations?from=${daysAgo(0)}&to=${daysAgo(0)}`]: {
        status: 200,
        body: { ...report(), items: [] },
      },
    });
    renderApp('/reports/cancellations');
    const table = await screen.findByRole('table', { name: 'الإلغاءات بعد المطبخ' });
    await within(table).findByText('تأخر الطلب');
    expect(within(table).getByText('بعد التحضير')).toBeInTheDocument();
    expect(within(table).getByText('قبل التحضير')).toBeInTheDocument();
    expect(within(table).getByText('2× كباب')).toBeInTheDocument();
    expect(within(table).getByText('سامي')).toBeInTheDocument();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);

    fireEvent.click(screen.getByRole('radio', { name: 'اليوم' }));
    expect(await screen.findByText('لا إلغاءات في هذه الفترة.')).toBeInTheDocument();
    expect(mock.requestsTo('GET', path.slice(4))).toHaveLength(1);
  });

  it('shows a failed load with a retry', async () => {
    let calls = 0;
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meWith(OWNER_KEYS) },
      [`GET /v1/hall/cancellations?from=${daysAgo(6)}&to=${daysAgo(0)}`]: () => {
        calls += 1;
        return calls === 1
          ? apiError(500, 'internal', 'حدث خطأ غير متوقع. حاول مجدداً.')
          : { status: 200, body: report() };
      },
    });
    renderApp('/reports/cancellations');
    expect(await screen.findByText('حدث خطأ غير متوقع. حاول مجدداً.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'حاول مرة أخرى' }));
    expect(await screen.findByText('تأخر الطلب')).toBeInTheDocument();
  });
});
