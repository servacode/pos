import { fireEvent, screen, within } from '@testing-library/react';
import { stripBidiControls } from '@serva/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceSummary } from '../../test/devices';
import { apiError, mockFetch, type MockReply } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { evidence, MANAGER_KEYS, meWith, NOW, TODAY } from '../../test/reports';

const text = (element: Element) => stripBidiControls(element.textContent ?? '');

const till1 = deviceSummary({ id: 'dev-1', name: 'كاشير 1', code: '001' });
const till2 = deviceSummary({ id: 'dev-2', name: 'كاشير النعيم', code: '002' });
const waiting = deviceSummary({ id: 'dev-3', name: 'جهاز جديد', status: 'pending_approval', code: null });

function openEvidence(routes: Record<string, MockReply | (() => MockReply)>, keys = MANAGER_KEYS) {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: meWith(keys) },
    ...routes,
  });
  return { ...mock, ...renderApp('/evidence') };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('«شاشة الدليل»', () => {
  it('shows the first device: sent, duplicates, and every announced number arrived', async () => {
    openEvidence({
      'GET /v1/devices': { status: 200, body: { devices: [till1, till2, waiting] } },
      [`GET /v1/sync/evidence?deviceId=dev-1&date=${TODAY}`]: { status: 200, body: evidence() },
    });

    expect(
      await screen.findByText('صفر مفقود: آخر رقم أعلنه «كاشير 1» هو آخر رقم وصل، والمكرر لم يُحسب مرتين.'),
    ).toBeInTheDocument();
    for (const [label, value] of [
      ['أُرسل', '5'],
      ['قُبل', '5'],
      ['مكرر', '5'],
      ['رُفض', '0'],
      ['محجوز للمراجعة', '0'],
    ] as const) {
      expect(screen.getByText(label).nextElementSibling).toHaveTextContent(value);
    }
    const rows = within(screen.getByRole('table')).getAllByRole('row').map(text);
    expect(rows).toEqual([
      'السلسلةآخر رقم أعلنه الجهازآخر رقم وصلالحالة',
      'الفواتيرINV-001-001-0000005INV-001-001-0000005وصل كله',
      'الوردياتSFT-001-001-0000001SFT-001-001-0000001وصل كله',
    ]);
    // A device still waiting for approval has nothing to show.
    const options = within(screen.getByLabelText('الجهاز')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['كاشير 1 · 001', 'كاشير النعيم · 002']);
    expect(screen.getByRole('link', { name: 'شاشة الدليل' })).toHaveAttribute('aria-current', 'page');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('names what has not arrived, per device and day', async () => {
    const { requestsTo } = openEvidence({
      'GET /v1/devices': { status: 200, body: { devices: [till1, till2] } },
      [`GET /v1/sync/evidence?deviceId=dev-1&date=${TODAY}`]: { status: 200, body: evidence() },
      'GET /v1/sync/evidence?deviceId=dev-2&date=2026-10-30': {
        status: 200,
        body: evidence({
          deviceId: 'dev-2',
          deviceName: 'كاشير النعيم',
          rejected: 1,
          lastAnnouncedNumber: { INV: 'INV-001-002-0000320', CSH: 'CSH-001-002-0000004' },
          lastReceivedNumber: { INV: 'INV-001-002-0000317', CSH: 'CSH-001-002-0000004' },
        }),
      },
    });
    await screen.findByText(/صفر مفقود/);

    fireEvent.change(screen.getByLabelText('الجهاز'), { target: { value: 'dev-2' } });
    fireEvent.change(screen.getByLabelText('اليوم'), { target: { value: '2026-10-30' } });

    expect(await screen.findByText('لم يصل كل ما أعلنه «كاشير النعيم»: الفواتير.')).toBeInTheDocument();
    const invoices = screen.getByRole('row', { name: /^الفواتير/ });
    expect(within(invoices).getByText('ناقص')).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /^حركات الدرج/ })).getByText('وصل كله'),
    ).toBeInTheDocument();
    expect(requestsTo('GET', '/v1/sync/evidence?deviceId=dev-2&date=2026-10-30')).toHaveLength(1);
  });

  it('warns about rejected or held documents even when nothing is missing', async () => {
    openEvidence({
      'GET /v1/devices': { status: 200, body: { devices: [till1] } },
      [`GET /v1/sync/evidence?deviceId=dev-1&date=${TODAY}`]: {
        status: 200,
        body: evidence({ quarantined: 2 }),
      },
    });

    expect(
      await screen.findByText('وصل كل ما أعلنه «كاشير 1»، وفيه مستندات مرفوضة أو محجوزة للمراجعة.'),
    ).toBeInTheDocument();
  });

  it('says there is no device yet', async () => {
    openEvidence({ 'GET /v1/devices': { status: 200, body: { devices: [waiting] } } });

    expect(await screen.findByText('لا أجهزة مربوطة بعد.')).toBeInTheDocument();
  });

  it('shows failed loads with a retry', async () => {
    let calls = 0;
    openEvidence({
      'GET /v1/devices': () => {
        calls += 1;
        return calls === 1
          ? apiError(503, 'unavailable', 'الخادم مشغول حالياً. حاول بعد قليل.')
          : { status: 200, body: { devices: [till1] } };
      },
      [`GET /v1/sync/evidence?deviceId=dev-1&date=${TODAY}`]: apiError(
        403,
        'forbidden',
        'هذه الأرقام للمالك والمدير فقط.',
      ),
    });

    expect(await screen.findByText('الخادم مشغول حالياً. حاول بعد قليل.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'أعد المحاولة' }));
    expect(await screen.findByText('هذه الأرقام للمالك والمدير فقط.')).toBeInTheDocument();
  });

  it('is closed to a cashier', async () => {
    openEvidence({}, ['sale.create']);

    expect(await screen.findByText('هذه الشاشة ليست ضمن صلاحياتك.')).toBeInTheDocument();
  });
});
