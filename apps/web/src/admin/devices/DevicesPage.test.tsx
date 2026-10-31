import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceSummary, MeResponse } from '@serva/core';
import { deviceSummary, pairingCode } from '../../test/devices';
import { apiError, mockFetch, type MockReply, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { DEVICES_POLL_MS } from './DevicesPage';

const branches = [
  { id: 'branch-1', code: '001', name: 'الفرع الرئيسي' },
  { id: 'branch-2', code: '002', name: 'دوار النعيم' },
];

function me(role: 'owner' | 'manager' = 'owner'): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: {
      ...base.user,
      roles: [{ key: role, name: role === 'owner' ? 'المالك' : 'مدير الفرع', branchId: null }],
      permissions:
        role === 'owner'
          ? ['sale.create', 'devices.view', 'devices.manage']
          : ['sale.create', 'devices.view'],
    },
    branches,
  };
}

const cashier1 = deviceSummary();
const offlineTill = deviceSummary({
  id: 'dev-2',
  name: 'كاشير النعيم',
  code: '001',
  branchId: 'branch-2',
  branchName: 'دوار النعيم',
  platform: 'android',
  kind: 'android_pos',
  lastSeenAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  missingDocuments: 3,
  unsentCount: 12,
});
const stolen = deviceSummary({
  id: 'dev-3',
  name: 'كاشير قديم',
  code: '002',
  status: 'revoked',
  revokedAt: new Date(Date.now() - 3600_000).toISOString(),
});
const refused = deviceSummary({ id: 'dev-4', name: 'جهاز غريب', status: 'rejected', code: null });
const waiting = deviceSummary({
  id: 'dev-5',
  name: 'كاشير 3',
  status: 'pending_approval',
  code: null,
  lastSeenAt: null,
  missingDocuments: null,
  unsentCount: null,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
});

type Routes = Record<string, MockReply | ((request: MockRequest) => MockReply | Promise<MockReply>)>;

function openDevices(
  devices: DeviceSummary[] | (() => DeviceSummary[]),
  routes: Routes = {},
  role?: 'manager',
) {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: me(role) },
    'GET /v1/devices': () => ({
      status: 200,
      body: { devices: typeof devices === 'function' ? devices() : devices },
    }),
    ...routes,
  });
  return { ...mock, ...renderApp('/devices') };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('/devices list', () => {
  it('groups devices by branch with their code, status, last contact and what has not arrived', async () => {
    openDevices([cashier1, offlineTill, stolen, refused]);

    expect(await screen.findByRole('heading', { name: 'الأجهزة', level: 1 })).toBeInTheDocument();
    const main = screen.getByRole('region', { name: 'الفرع الرئيسي' });
    const naim = screen.getByRole('region', { name: 'دوار النعيم' });

    const first = within(main).getAllByRole('listitem');
    expect(first).toHaveLength(2);
    expect(first[0]).toHaveTextContent('كاشير 1');
    expect(first[0]).toHaveTextContent('رمز 001 · جهاز كاشير · ويندوز');
    expect(first[0]).toHaveTextContent('نشط');
    expect(first[0]).toHaveTextContent('آخر اتصال قبل 5 دقائق');
    expect(first[0]).toHaveTextContent('كل شيء أُرسل');
    expect(first[1]).toHaveTextContent('كاشير قديم');
    expect(first[1]).toHaveTextContent('موقوف');
    expect(first[1]).toHaveTextContent('أُوقف قبل ساعة');
    expect(within(first[1]!).queryByRole('button', { name: /أوقف عن بُعد/ })).not.toBeInTheDocument();

    const [till] = within(naim).getAllByRole('listitem');
    expect(till).toHaveTextContent('كاشير أندرويد بطابعة · أندرويد');
    expect(till).toHaveTextContent('آخر اتصال قبل 3 ساعات');
    expect(within(till!).getByText('لم يصل: 3 مستندات')).toHaveClass('text-danger-ink');

    // A refused request is not a device of the store.
    expect(screen.queryByText('جهاز غريب')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'الأجهزة' })).toHaveAttribute('aria-current', 'page');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('says there is no device yet and offers to link one', async () => {
    openDevices([]);

    expect(await screen.findByText('لا أجهزة مربوطة بعد.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'اربط جهازاً جديداً' })).toHaveLength(2);
  });

  it('shows a load error with a retry', async () => {
    let fail = true;
    const { user } = openDevices([], {
      'GET /v1/devices': () =>
        fail
          ? apiError(503, 'unavailable', 'الخادم مشغول حالياً.')
          : { status: 200, body: { devices: [cashier1] } },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('الخادم مشغول حالياً.');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'أعد المحاولة' }));
    expect(await screen.findByText('كاشير 1')).toBeInTheDocument();
  });

  it('gives a manager the list without the owner’s buttons', async () => {
    openDevices([cashier1, waiting], {}, 'manager');

    expect(await screen.findByText('كاشير 1')).toBeInTheDocument();
    expect(screen.getByText('ينتظر موافقة المالك.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /اسمح|ارفض|اربط جهازاً|أوقف|غيّر اسم/ }),
    ).not.toBeInTheDocument();
  });
});

describe('approving a new device', () => {
  it('puts devices waiting for «اسمح» on top, and allows one', async () => {
    let list = [cashier1, waiting];
    const { user, requestsTo } = openDevices(() => list, {
      'POST /v1/devices/dev-5/approve': () => {
        list = [cashier1, { ...waiting, status: 'active', code: '002' }];
        return { status: 200, body: list[1] };
      },
    });

    const card = await screen.findByRole('article', { name: 'طلب ربط: كاشير 3' });
    expect(screen.getByRole('heading', { name: 'بانتظار موافقتك' })).toBeInTheDocument();
    expect(card).toHaveTextContent('جهاز جديد يطلب الربط');
    expect(card).toHaveTextContent('الفرع الرئيسي · قبل دقيقة واحدة');
    // On a phone the two buttons share a row: «ارفض» narrow, «اسمح» wide, both 48 px tall.
    expect(within(card).getByRole('button', { name: 'اسمح: كاشير 3' })).toHaveClass('min-h-12');

    await user.click(within(card).getByRole('button', { name: 'اسمح: كاشير 3' }));

    await vi.waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument());
    expect(requestsTo('POST', '/v1/devices/dev-5/approve')).toHaveLength(1);
    const rows = within(screen.getByRole('region', { name: 'الفرع الرئيسي' })).getAllByRole('listitem');
    expect(rows[1]).toHaveTextContent('رمز 002');
  });

  it('refuses one', async () => {
    const { user, requestsTo } = openDevices([waiting], {
      'POST /v1/devices/dev-5/reject': { status: 200, body: { ...waiting, status: 'rejected' } },
    });

    await user.click(await screen.findByRole('button', { name: 'ارفض: كاشير 3' }));

    await vi.waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument());
    expect(requestsTo('POST', '/v1/devices/dev-5/reject')).toHaveLength(1);
    expect(screen.queryByText('كاشير 3')).not.toBeInTheDocument();
  });

  it('shows why an approval failed and reloads the list', async () => {
    const { user, requestsTo } = openDevices([waiting], {
      'POST /v1/devices/dev-5/approve': apiError(404, 'not_found', 'انتهى هذا الطلب.'),
    });

    await user.click(await screen.findByRole('button', { name: 'اسمح: كاشير 3' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('انتهى هذا الطلب.');
    await vi.waitFor(() => expect(requestsTo('GET', '/v1/devices')).toHaveLength(2));
  });

  it('does not ask for the list again while no device waits', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const list = [cashier1];
    const { requestsTo } = openDevices(() => list);
    await screen.findByText('كاشير 1');

    await act(() => vi.advanceTimersByTimeAsync(DEVICES_POLL_MS * 2));
    expect(requestsTo('GET', '/v1/devices')).toHaveLength(1);
  });

  it('keeps asking while a device waits, until it is decided', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let list = [cashier1, waiting];
    const { requestsTo } = openDevices(() => list);
    await screen.findByRole('article', { name: 'طلب ربط: كاشير 3' });

    await act(() => vi.advanceTimersByTimeAsync(DEVICES_POLL_MS));
    await vi.waitFor(() => expect(requestsTo('GET', '/v1/devices')).toHaveLength(2));
    list = [cashier1];
    await act(() => vi.advanceTimersByTimeAsync(DEVICES_POLL_MS));
    await vi.waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument());
    const asked = requestsTo('GET', '/v1/devices').length;
    await act(() => vi.advanceTimersByTimeAsync(DEVICES_POLL_MS * 3));
    expect(requestsTo('GET', '/v1/devices')).toHaveLength(asked);
  });
});

describe('the pairing dialog «اربط جهازاً جديداً»', () => {
  it('shows the QR, the code XXXX-XXXX, the store code and a live countdown, with «رمز جديد»', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let codes = 0;
    const { user, requestsTo } = openDevices([cashier1], {
      'POST /v1/devices/pairing-codes': () => ({
        status: 200,
        body: pairingCode(++codes === 1 ? {} : { manualCode: 'ABCD2345' }),
      }),
    });

    await user.click(await screen.findByRole('button', { name: 'اربط جهازاً جديداً' }));
    const dialog = await screen.findByRole('dialog', { name: 'اربط جهازاً جديداً' });

    expect(
      await within(dialog).findByRole('img', { name: 'رمز QR لربط جهاز في الفرع الرئيسي' }),
    ).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/devices/pairing-codes')[0]!.body).toEqual({ branchId: 'branch-1' });
    expect(within(dialog).getByText('K7QM-4TZP')).toHaveAttribute('dir', 'ltr');
    expect(within(dialog).getByText('482130')).toBeInTheDocument();
    const timer = within(dialog).getByRole('timer');
    expect(timer).toHaveTextContent(/ينتهي بعد (10:00|9:59)/);
    await act(() => vi.advanceTimersByTimeAsync(61_000));
    expect(timer).toHaveTextContent(/ينتهي بعد 8:5\d/);
    expect(dialog.querySelector('svg[role="img"] path')?.getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/);

    await user.click(within(dialog).getByRole('button', { name: 'رمز جديد' }));
    expect(await within(dialog).findByText('ABCD-2345')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/devices/pairing-codes')).toHaveLength(2);
  });

  it('makes the code for the branch picked', async () => {
    const { user, requestsTo } = openDevices([cashier1], {
      'POST /v1/devices/pairing-codes': (request) => ({
        status: 200,
        body: pairingCode({
          branchId: (request.body as { branchId: string }).branchId,
          branchName:
            (request.body as { branchId: string }).branchId === 'branch-2' ? 'دوار النعيم' : 'الفرع الرئيسي',
        }),
      }),
    });

    await user.click(await screen.findByRole('button', { name: 'اربط جهازاً جديداً' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('img', { name: /الفرع الرئيسي/ });
    await user.selectOptions(within(dialog).getByLabelText('الفرع'), 'branch-2');

    expect(
      await within(dialog).findByRole('img', { name: 'رمز QR لربط جهاز في دوار النعيم' }),
    ).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/devices/pairing-codes').map((r) => r.body)).toEqual([
      { branchId: 'branch-1' },
      { branchId: 'branch-2' },
    ]);
  });

  it('says when the code ran out', async () => {
    const { user } = openDevices([cashier1], {
      'POST /v1/devices/pairing-codes': {
        status: 200,
        body: pairingCode({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      },
    });

    await user.click(await screen.findByRole('button', { name: 'اربط جهازاً جديداً' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('انتهى الرمز. اطلب رمزاً جديداً.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows a refused code request', async () => {
    const { user } = openDevices([cashier1], {
      'POST /v1/devices/pairing-codes': apiError(403, 'forbidden', 'هذا للمالك وحده.'),
    });

    await user.click(await screen.findByRole('button', { name: 'اربط جهازاً جديداً' }));
    expect(await within(await screen.findByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'هذا للمالك وحده.',
    );
  });

  it('asks every 5 s while open, and lets the owner allow the device that used the code right there', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let list = [cashier1];
    const { user, requestsTo } = openDevices(() => list, {
      'POST /v1/devices/pairing-codes': { status: 200, body: pairingCode() },
      'POST /v1/devices/dev-5/approve': () => {
        list = [cashier1, { ...waiting, status: 'active', code: '002' }];
        return { status: 200, body: list[1] };
      },
    });

    await user.click(await screen.findByRole('button', { name: 'اربط جهازاً جديداً' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('حين يستعمل جهاز هذا الرمز يظهر طلبه هنا لتسمح له.'),
    ).toBeInTheDocument();

    list = [cashier1, waiting];
    await act(() => vi.advanceTimersByTimeAsync(DEVICES_POLL_MS));
    await vi.waitFor(() => expect(requestsTo('GET', '/v1/devices')).toHaveLength(2));
    await user.click(await within(dialog).findByRole('button', { name: 'اسمح: كاشير 3' }));

    await vi.waitFor(() => expect(requestsTo('POST', '/v1/devices/dev-5/approve')).toHaveLength(1));
    await vi.waitFor(() => expect(within(dialog).queryByRole('article')).not.toBeInTheDocument());

    await user.click(within(dialog).getByRole('button', { name: 'تم' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const asked = requestsTo('GET', '/v1/devices').length;
    await act(() => vi.advanceTimersByTimeAsync(DEVICES_POLL_MS * 2));
    expect(requestsTo('GET', '/v1/devices')).toHaveLength(asked);
  });
});

describe('renaming and stopping a device', () => {
  it('renames inline with the version it read', async () => {
    const { user, requestsTo } = openDevices([cashier1], {
      'PATCH /v1/devices/dev-1': (request) => ({
        status: 200,
        body: { ...cashier1, name: (request.body as { name: string }).name, version: 2 },
      }),
    });

    await user.click(await screen.findByRole('button', { name: 'غيّر اسم «كاشير 1»' }));
    const field = screen.getByLabelText('الاسم الجديد لـ«كاشير 1»');
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(screen.getByText('اسم الجهاز مطلوب')).toBeInTheDocument();
    await user.type(field, '  صندوق المشروبات ');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));

    expect(await screen.findByText('صندوق المشروبات')).toBeInTheDocument();
    expect(requestsTo('PATCH', '/v1/devices/dev-1')[0]!.body).toEqual({
      name: 'صندوق المشروبات',
      version: 1,
    });
    expect(screen.queryByRole('button', { name: 'احفظ' })).not.toBeInTheDocument();
  });

  it('says when someone else changed it first, and reloads', async () => {
    const { user, requestsTo } = openDevices([cashier1], {
      'PATCH /v1/devices/dev-1': apiError(409, 'conflict', 'تغيّر السجل.'),
    });

    await user.click(await screen.findByRole('button', { name: 'غيّر اسم «كاشير 1»' }));
    await user.type(screen.getByLabelText('الاسم الجديد لـ«كاشير 1»'), ' أ');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));

    expect(
      await screen.findByText('غيّر أحدٌ هذا الجهاز للتو. حدّثنا القائمة، جرّب مرة أخرى.'),
    ).toBeInTheDocument();
    await vi.waitFor(() => expect(requestsTo('GET', '/v1/devices')).toHaveLength(2));
  });

  it('explains what happens to unsent documents before stopping a device from afar', async () => {
    const { user, requestsTo } = openDevices([offlineTill], {
      'POST /v1/devices/dev-2/revoke': {
        status: 200,
        body: { ...offlineTill, status: 'revoked', revokedAt: new Date().toISOString() },
      },
    });

    await user.click(await screen.findByRole('button', { name: 'أوقف عن بُعد: كاشير النعيم' }));
    let dialog = await screen.findByRole('dialog', { name: 'أوقف «كاشير النعيم» عن بُعد؟' });
    expect(dialog).toHaveTextContent('يتوقف البيع عليه عند أول اتصال');
    expect(dialog).toHaveTextContent('بانتظار الإرسال على الجهاز: 12 مستنداً');
    expect(dialog).toHaveTextContent('أعلن عنها الجهاز ولم تصل: 3 مستندات');
    expect(dialog).toHaveTextContent('ما يرسله بعد الإيقاف لا يضيع');
    // The safe choice comes first.
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['', 'تراجع', 'أوقف الجهاز']);
    await user.click(within(dialog).getByRole('button', { name: 'تراجع' }));
    expect(requestsTo('POST', '/v1/devices/dev-2/revoke')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'أوقف عن بُعد: كاشير النعيم' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'أوقف الجهاز' }));

    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(requestsTo('POST', '/v1/devices/dev-2/revoke')).toHaveLength(1);
    const row = within(screen.getByRole('region', { name: 'دوار النعيم' })).getByRole('listitem');
    expect(row).toHaveTextContent('موقوف');
    expect(within(row).queryByRole('button', { name: /أوقف عن بُعد/ })).not.toBeInTheDocument();
  });
});
