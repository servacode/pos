import 'fake-indexeddb/auto';
import { DirectionProvider } from '@radix-ui/react-direction';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DensityProvider } from '@serva/ui';
import { deviceStore, resetDeviceStore } from '../../offline/database';
import { loadPendingLink, savePendingLink, type SavedLink } from '../../offline/link';
import { APP_VERSION } from '../../offline/sync';
import { activatedDevice, fakeLinkHelpers, pendingActivation, PUBLIC_KEY } from '../../test/devices';
import { apiError, mockFetch } from '../../test/fetchMock';
import { authResponse, makeMe } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { DeviceLink } from './DeviceLink';

const QR_TOKEN = `spq_${'Q'.repeat(22)}`;
const ACTIVATION = '/v1/devices/activations/act-1';

function renderLink({
  path = '/pos',
  helpers = fakeLinkHelpers(),
  timers = false,
}: { path?: string; helpers?: ReturnType<typeof fakeLinkHelpers>; timers?: boolean } = {}) {
  const user = userEvent.setup(timers ? { advanceTimers: vi.advanceTimersByTime.bind(vi) } : {});
  const onLinked = vi.fn();
  render(
    <DirectionProvider dir="rtl">
      <DensityProvider density="touch">
        <MemoryRouter initialEntries={[path]}>
          <DeviceLink onLinked={onLinked} helpers={helpers} />
        </MemoryRouter>
      </DensityProvider>
    </DirectionProvider>,
  );
  return { user, onLinked, helpers };
}

async function savedLink(overrides: Partial<SavedLink> = {}) {
  const link: SavedLink = {
    ...pendingActivation(),
    method: 'code',
    manualCode: 'K7QM4TZP',
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
  await savePendingLink(deviceStore(), link);
  return link;
}

afterEach(async () => {
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, 'BarcodeDetector');
  await resetDeviceStore();
});

describe('step 1 «هل هذا جهاز كاشير؟»', () => {
  it('offers the code, the link and the owner account, and asks nothing of the server', async () => {
    const { fetchMock } = mockFetch({});
    renderLink();

    expect(await screen.findByRole('heading', { name: 'هل هذا جهاز كاشير؟' })).toBeInTheDocument();
    const ways = screen.getByRole('group', { name: 'طريقة الربط' });
    expect(
      within(ways)
        .getAllByRole('radio')
        .map((r) => r.closest('label')?.textContent),
    ).toEqual([
      expect.stringContaining('الصق رابط الربط'),
      expect.stringContaining('اكتب رمز الربط مع رمز المتجر'),
      expect.stringContaining('ادخل بحساب المالك'),
    ]);
    expect(screen.getByRole('radio', { name: /اكتب رمز الربط/ })).toBeChecked();
    expect(screen.getByRole('list', { name: 'خطوات الإعداد' })).toHaveTextContent('ربط الجهاز');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the code as XXXX-XXXX while typing and takes Arabic digits', async () => {
    mockFetch({});
    const { user } = renderLink();

    const storeCode = await screen.findByLabelText('رمز المتجر');
    await user.type(storeCode, '٤٨٢١٣٠٩');
    expect(storeCode).toHaveValue('482130');

    const code = screen.getByLabelText('رمز الربط (8 خانات)');
    await user.type(code, 'k7qm 4tz٥');
    expect(code).toHaveValue('K7QM-4TZ5');
    expect(code).toHaveAttribute('dir', 'ltr');
  });

  it('refuses a short code and a bad store code before any request', async () => {
    const { fetchMock } = mockFetch({});
    const { user } = renderLink();

    await user.type(await screen.findByLabelText('رمز المتجر'), '4821');
    await user.type(screen.getByLabelText('رمز الربط (8 خانات)'), 'K7QM');
    await user.click(screen.getByRole('button', { name: 'التالي: سمِّ الجهاز' }));

    expect(screen.getByText('رمز المتجر 6 أرقام')).toBeInTheDocument();
    expect(screen.getByText('رمز الربط 8 حروف وأرقام كما يظهر في لوحة الإدارة')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('takes a pasted pairing link and refuses anything else', async () => {
    mockFetch({});
    const { user } = renderLink();

    await user.click(await screen.findByRole('radio', { name: /الصق رابط الربط/ }));
    const field = screen.getByLabelText('رابط الربط');
    await user.type(field, 'https://example.com/whatever');
    await user.click(screen.getByRole('button', { name: 'التالي: سمِّ الجهاز' }));
    expect(screen.getByText('هذا ليس رابط ربط من سيرفا. انسخه كما هو من الإدارة.')).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, `https://app.serva.sy/link#${QR_TOKEN}`);
    await user.click(screen.getByRole('button', { name: 'التالي: سمِّ الجهاز' }));
    expect(await screen.findByRole('heading', { name: 'سمِّ هذا الجهاز' })).toBeInTheDocument();
    expect(screen.getByText('رمز QR')).toBeInTheDocument();
  });

  it('scans the QR with the camera where the browser can, and stops the camera', async () => {
    const stop = vi.fn();
    const detect = vi
      .fn()
      .mockResolvedValueOnce([{ rawValue: 'not a serva code' }])
      .mockResolvedValue([{ rawValue: `https://app.serva.sy/link#${QR_TOKEN}` }]);
    vi.stubGlobal(
      'BarcodeDetector',
      vi.fn(function BarcodeDetector() {
        return { detect };
      }),
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    mockFetch({
      'POST /v1/devices/activate': { status: 200, body: pendingActivation() },
      [`GET ${ACTIVATION}`]: { status: 200, body: { status: 'rejected' } },
    });
    try {
      const { user } = renderLink();
      const qr = await screen.findByRole('radio', { name: /امسح رمز QR من الإدارة/ });
      expect(qr.closest('label')).toHaveTextContent('الأسرع');
      await user.click(qr);
      await user.click(screen.getByRole('button', { name: 'افتح الكاميرا وامسح الرمز' }));

      expect(
        await screen.findByRole('heading', { name: 'سمِّ هذا الجهاز' }, { timeout: 3000 }),
      ).toBeInTheDocument();
      expect(detect).toHaveBeenCalledTimes(2);
      expect(stop).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, 'mediaDevices');
    }
  });

  it('opens a scanned link (/link#spq_…) straight on naming the device', async () => {
    mockFetch({});
    renderLink({ path: `/pos#${QR_TOKEN}` });

    expect(await screen.findByRole('heading', { name: 'سمِّ هذا الجهاز' })).toBeInTheDocument();
  });
});

describe('step 2: naming, then asking the owner', () => {
  async function toNaming(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByLabelText('رمز المتجر'), '482130');
    await user.type(screen.getByLabelText('رمز الربط (8 خانات)'), 'k7qm4tzp');
    await user.click(screen.getByRole('button', { name: 'التالي: سمِّ الجهاز' }));
    await screen.findByRole('heading', { name: 'سمِّ هذا الجهاز' });
  }

  it('sends the code, the name, the kind, the platform and the public key, then waits', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/devices/activate': { status: 200, body: pendingActivation() },
      [`GET ${ACTIVATION}`]: { status: 200, body: pendingActivation() },
    });
    const { user, helpers } = renderLink();
    await toNaming(user);

    expect(screen.getByText('الذي اختاره المالك حين أنشأ الرمز')).toBeInTheDocument();
    expect(screen.getByText('جهاز كاشير · متصفح')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'اطلب موافقة المالك' }));
    expect(screen.getByText('اسم الجهاز مطلوب')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'كاشير 3' }));
    expect(screen.getByLabelText('اسم الجهاز')).toHaveValue('كاشير 3');
    await user.click(screen.getByRole('button', { name: 'اطلب موافقة المالك' }));

    expect(
      await screen.findByRole('heading', { name: 'بانتظار موافقة المالك من جواله' }),
    ).toBeInTheDocument();
    expect(helpers.createDeviceKeys).toHaveBeenCalledOnce();
    const [activate] = requestsTo('POST', '/v1/devices/activate');
    expect(activate!.body).toEqual({
      method: 'code',
      storeCode: '482130',
      manualCode: 'K7QM4TZP',
      name: 'كاشير 3',
      kind: 'cashier',
      platform: 'browser',
      publicKey: PUBLIC_KEY,
      appVersion: APP_VERSION,
    });
    expect(activate!.headers.Authorization).toBeUndefined();
    // Kept in the device database, so a reload goes on waiting.
    expect(await loadPendingLink(deviceStore())).toMatchObject({
      activationId: 'act-1',
      method: 'code',
      manualCode: 'K7QM4TZP',
    });
  });

  it('shows a refused code on the naming step, and «رجوع» keeps what was typed', async () => {
    mockFetch({
      'POST /v1/devices/activate': apiError(400, 'otp_invalid', 'رمز الربط غير صحيح أو انتهت مدته.'),
    });
    const { user } = renderLink();
    await toNaming(user);
    await user.type(screen.getByLabelText('اسم الجهاز'), 'صندوق المشروبات');
    await user.click(screen.getByRole('button', { name: 'اطلب موافقة المالك' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('رمز الربط غير صحيح أو انتهت مدته.');
    await user.click(screen.getByRole('button', { name: 'رجوع' }));
    expect(await screen.findByLabelText('رمز الربط (8 خانات)')).toHaveValue('K7QM-4TZP');
    expect(screen.getByLabelText('رمز المتجر')).toHaveValue('482130');
  });
});

describe('step 3 «بانتظار موافقة المالك من جواله»', () => {
  it('goes on waiting after a reload, asking with the activation secret', async () => {
    const link = await savedLink();
    const { requestsTo } = mockFetch({ [`GET ${ACTIVATION}`]: { status: 200, body: pendingActivation() } });
    renderLink();

    expect(
      await screen.findByRole('heading', { name: 'بانتظار موافقة المالك من جواله' }),
    ).toBeInTheDocument();
    expect(screen.getByText('كاشير 3')).toBeInTheDocument();
    expect(screen.getByText('الرقة · شارع تل أبيض')).toBeInTheDocument();
    expect(screen.getByText('رمز الربط K7QM-4TZP')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'الوقت الباقي للموافقة' })).toBeInTheDocument();
    expect(screen.getByText(/ينتهي الطلب بعد/)).toHaveTextContent(/[89]:\d\d/);
    await vi.waitFor(() => expect(requestsTo('GET', ACTIVATION)).toHaveLength(1));
    expect(requestsTo('GET', ACTIVATION)[0]!.headers.Authorization).toBe(
      `Activation ${link.activationSecret}`,
    );
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('asks again after pollAfterSeconds, then saves the device, downloads and opens the login code', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await savedLink({ pollAfterSeconds: 4 });
    let answers = 0;
    const { requestsTo } = mockFetch({
      [`GET ${ACTIVATION}`]: () =>
        ++answers === 1
          ? { status: 200, body: pendingActivation({ pollAfterSeconds: 4 }) }
          : { status: 200, body: { status: 'active', device: activatedDevice } },
    });
    const { onLinked, helpers } = renderLink({ timers: true });

    await screen.findByRole('heading', { name: 'بانتظار موافقة المالك من جواله' });
    await vi.waitFor(() => expect(requestsTo('GET', ACTIVATION)).toHaveLength(1));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(requestsTo('GET', ACTIVATION)).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1500));

    await vi.waitFor(() => expect(onLinked).toHaveBeenCalledOnce());
    expect(requestsTo('GET', ACTIVATION)).toHaveLength(2);
    expect(helpers.saveActivatedDevice).toHaveBeenCalledWith(deviceStore(), activatedDevice);
    expect(helpers.runBootstrap).toHaveBeenCalledOnce();
    expect(await deviceStore().getDevice()).toMatchObject({
      token: activatedDevice.token,
      deviceCode: '003',
    });
    expect(await loadPendingLink(deviceStore())).toBeNull();
  });

  it('shows the download with its progress bar before the login code', async () => {
    await savedLink();
    let finish!: () => void;
    const helpers = fakeLinkHelpers({ bootstrap: () => new Promise<void>((resolve) => (finish = resolve)) });
    mockFetch({
      [`GET ${ACTIVATION}`]: { status: 200, body: { status: 'active', device: activatedDevice } },
    });
    const { onLinked } = renderLink({ helpers });

    expect(await screen.findByRole('heading', { name: 'جارٍ تنزيل بيانات المحل…' })).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'تنزيل بيانات المحل' });
    await vi.waitFor(() => expect(bar).toHaveAttribute('aria-valuetext', '40%'));
    expect(
      screen.getByRole('list', { name: 'خطوات الإعداد' }).querySelector('[aria-current="step"]'),
    ).toHaveTextContent('التنزيل');
    expect(onLinked).not.toHaveBeenCalled();

    finish();
    expect(
      await screen.findByRole('heading', { name: 'هذا الجهاز جاهز للعمل دون إنترنت' }),
    ).toBeInTheDocument();
    expect(onLinked).toHaveBeenCalledOnce();
  });

  it('lets a cut download go on from where it stopped', async () => {
    await savedLink();
    let calls = 0;
    const helpers = fakeLinkHelpers({
      bootstrap: () => (++calls === 1 ? Promise.reject(new Error('network')) : Promise.resolve()),
    });
    mockFetch({
      [`GET ${ACTIVATION}`]: { status: 200, body: { status: 'active', device: activatedDevice } },
    });
    const { user, onLinked } = renderLink({ helpers });

    expect(await screen.findByRole('alert')).toHaveTextContent('توقف التنزيل');
    expect(helpers.saveActivatedDevice).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'أكمل التنزيل' }));
    await vi.waitFor(() => expect(onLinked).toHaveBeenCalledOnce());
    expect(helpers.runBootstrap).toHaveBeenCalledTimes(2);
    expect(helpers.saveActivatedDevice).toHaveBeenCalledOnce();
  });

  it('says so when the owner refuses, and starts over cleanly', async () => {
    await savedLink();
    mockFetch({ [`GET ${ACTIVATION}`]: { status: 200, body: { status: 'rejected' } } });
    const { user } = renderLink();

    expect(await screen.findByRole('heading', { name: 'رفض المالك ربط هذا الجهاز' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ابدأ من جديد' }));
    expect(await screen.findByRole('heading', { name: 'هل هذا جهاز كاشير؟' })).toBeInTheDocument();
    expect(await loadPendingLink(deviceStore())).toBeNull();
  });

  it.each([
    ['the server says expired', { status: 200, body: { status: 'expired' } }],
    ['the answer was already given (410)', apiError(410, 'not_found', 'انتهى الطلب')],
  ])('ends the wait when %s', async (_, reply) => {
    await savedLink();
    mockFetch({ [`GET ${ACTIVATION}`]: reply });
    renderLink();

    expect(await screen.findByRole('heading', { name: 'انتهت مهلة الطلب' })).toBeInTheDocument();
  });

  it('ends the wait when the countdown runs out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const expiresAt = new Date(Date.now() + 5000).toISOString();
    await savedLink({ expiresAt });
    const { requestsTo } = mockFetch({
      [`GET ${ACTIVATION}`]: { status: 200, body: pendingActivation({ expiresAt, pollAfterSeconds: 30 }) },
    });
    renderLink({ timers: true });

    await screen.findByRole('heading', { name: 'بانتظار موافقة المالك من جواله' });
    expect(screen.getByText(/ينتهي الطلب بعد/)).toHaveTextContent(/0:0[45]/);
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(await screen.findByRole('heading', { name: 'انتهت مهلة الطلب' })).toBeInTheDocument();
    expect(requestsTo('GET', ACTIVATION)).toHaveLength(1);
  });

  it('keeps waiting through a lost connection and says so', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await savedLink({ pollAfterSeconds: 3 });
    let online = false;
    const { requestsTo } = mockFetch({
      [`GET ${ACTIVATION}`]: () => {
        if (!online) throw new TypeError('Failed to fetch');
        return { status: 200, body: pendingActivation() };
      },
    });
    renderLink({ timers: true });

    expect(await screen.findByText(/انقطع الإنترنت/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'بانتظار موافقة المالك من جواله' })).toBeInTheDocument();
    online = true;
    await act(() => vi.advanceTimersByTimeAsync(3500));
    await vi.waitFor(() => expect(screen.queryByText(/انقطع الإنترنت/)).not.toBeInTheDocument());
    expect(requestsTo('GET', ACTIVATION).length).toBeGreaterThanOrEqual(2);
  });

  it('lets the owner who is here sign in instead, or cancel the request', async () => {
    await savedLink();
    mockFetch({ [`GET ${ACTIVATION}`]: { status: 200, body: pendingActivation() } });
    const { user } = renderLink();

    await user.click(await screen.findByRole('button', { name: 'المالك هنا؟ ادخل بحسابه' }));
    expect(await screen.findByRole('radio', { name: /ادخل بحساب المالك/ })).toBeChecked();
    expect(await loadPendingLink(deviceStore())).toBeNull();
  });
});

describe('the owner signs in on the device', () => {
  const twoBranches = {
    ...makeMe(),
    branches: [
      { id: 'branch-1', code: '001', name: 'الرقة · شارع تل أبيض' },
      { id: 'branch-2', code: '002', name: 'الرقة · دوار النعيم' },
    ],
  };

  it('picks the branch, links at once with his token, and signs him out after', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/login': { status: 200, body: authResponse },
      'GET /v1/me': { status: 200, body: twoBranches },
      'POST /v1/devices/activate': { status: 200, body: { status: 'active', device: activatedDevice } },
      'POST /v1/auth/logout': { status: 204 },
    });
    const { user, onLinked, helpers } = renderLink();

    await user.click(await screen.findByRole('radio', { name: /ادخل بحساب المالك/ }));
    await user.type(screen.getByLabelText('رقم جوال المالك'), '0912345678');
    await user.type(screen.getByLabelText('كلمة السر'), 'secret-pass');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    expect(await screen.findByRole('heading', { name: 'أين يعمل هذا الجهاز؟' })).toBeInTheDocument();
    expect(requestsTo('GET', '/v1/me')[0]!.headers.Authorization).toBe('Bearer access-1');
    // No approval step when the owner himself is here.
    expect(screen.getByRole('list', { name: 'خطوات الإعداد' })).not.toHaveTextContent('موافقة المالك');
    await user.click(screen.getByRole('radio', { name: /دوار النعيم/ }));
    await user.type(screen.getByLabelText('اسم الجهاز'), 'كاشير النعيم');
    await user.click(screen.getByRole('button', { name: 'اربط الجهاز' }));

    await vi.waitFor(() => expect(onLinked).toHaveBeenCalledOnce());
    const [activate] = requestsTo('POST', '/v1/devices/activate');
    expect(activate!.headers.Authorization).toBe('Bearer access-1');
    expect(activate!.body).toMatchObject({ method: 'owner', branchId: 'branch-2', name: 'كاشير النعيم' });
    expect(helpers.saveActivatedDevice).toHaveBeenCalledWith(deviceStore(), activatedDevice);
    expect(requestsTo('POST', '/v1/auth/logout')).toHaveLength(1);
    expect(await loadPendingLink(deviceStore())).toBeNull();
  });

  it('refuses an account that is not the owner', async () => {
    mockFetch({
      'POST /v1/auth/login': { status: 200, body: authResponse },
      'GET /v1/me': {
        status: 200,
        body: {
          ...makeMe(),
          user: { ...makeMe().user, roles: [{ key: 'cashier', name: 'كاشير', branchId: null }] },
        },
      },
    });
    const { user } = renderLink();

    await user.click(await screen.findByRole('radio', { name: /ادخل بحساب المالك/ }));
    await user.type(screen.getByLabelText('رقم جوال المالك'), '0912345678');
    await user.type(screen.getByLabelText('كلمة السر'), 'secret-pass');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('هذا الحساب ليس حساب المالك');
  });

  it('shows a wrong password from the server', async () => {
    mockFetch({
      'POST /v1/auth/login': apiError(401, 'invalid_credentials', 'رقم الجوال أو كلمة السر غير صحيحة.'),
    });
    const { user } = renderLink();

    await user.click(await screen.findByRole('radio', { name: /ادخل بحساب المالك/ }));
    await user.type(screen.getByLabelText('رقم جوال المالك'), '0912345678');
    await user.type(screen.getByLabelText('كلمة السر'), 'wrong-pass');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('رقم الجوال أو كلمة السر غير صحيحة.');
  });
});
