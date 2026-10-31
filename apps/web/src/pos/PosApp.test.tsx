import 'fake-indexeddb/auto';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceRecord } from '@serva/sync/client';
import { deviceStore, resetDeviceStore } from '../offline/database';
import { LEGACY_DEVICE_KEY, loadDevice, type LocalDevice } from '../offline/device';
import { posSets } from '../test/pos';
import { renderApp } from '../test/renderApp';

const device: LocalDevice = {
  storeName: 'مقهى الياسمين',
  branchName: 'الرقة · شارع تل أبيض',
  deviceName: 'كاشير 3',
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(async () => {
  localStorage.clear();
  vi.restoreAllMocks();
  await resetDeviceStore();
});

const record: DeviceRecord = {
  ...device,
  deviceId: null,
  token: null,
  branchCode: null,
  deviceCode: null,
  sets: [],
};

/** A linked device keeps its record and the pulled sets in the device database (IndexedDB). */
async function linkDevice() {
  await deviceStore().putDevice(record);
  await deviceStore().applySnapshot(
    {
      sets: posSets() as unknown as Record<string, Array<Record<string, unknown> & { id: string }>>,
      cursors: {},
    },
    Date.now(),
  );
}

async function pickSamer(user: ReturnType<typeof renderApp>['user']) {
  const staff = await screen.findByRole('list', { name: 'الموظفون' });
  await user.click(within(staff).getByRole('button', { name: /سامر/ }));
}

describe('/pos (cashier)', () => {
  it('boots from the device alone and asks who works, with no network request', async () => {
    await linkDevice();
    renderApp('/pos');

    expect(await screen.findByRole('heading', { name: 'من يعمل الآن؟' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /سامر/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /مريم/ })).toBeInTheDocument();
    expect(screen.getByText('مقهى الياسمين')).toBeInTheDocument();
    expect(screen.getByText('الرقة · شارع تل أبيض · كاشير 3')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('opens without internet and says so, still with no request', async () => {
    await linkDevice();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderApp('/pos');

    await screen.findByRole('heading', { name: 'من يعمل الآن؟' });
    expect(screen.getByText('دون إنترنت · البيع مستمر')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('opens «ربط الجهاز» on an unlinked device, without calling the server', async () => {
    renderApp('/pos');

    expect(await screen.findByRole('heading', { name: 'هل هذا جهاز كاشير؟' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'خطوات الإعداد' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'لوحة الأرقام' })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps the keypad LTR with 7 8 9 on top, and fills the dots from taps and the keyboard', async () => {
    await linkDevice();
    const { user } = renderApp('/pos');
    await pickSamer(user);

    expect(screen.getByRole('heading', { name: 'أهلاً سامر' })).toBeInTheDocument();
    const keypad = await screen.findByRole('group', { name: 'لوحة الأرقام' });
    expect(keypad).toHaveAttribute('dir', 'ltr');
    const keys = within(keypad).getAllByRole('button');
    expect(keys.map((key) => key.textContent || key.getAttribute('aria-label'))).toEqual([
      '7',
      '8',
      '9',
      '4',
      '5',
      '6',
      '1',
      '2',
      '3',
      '0',
      'امسح رقماً',
    ]);

    const dots = screen.getByRole('status');
    await user.click(within(keypad).getByRole('button', { name: '1' }));
    await user.click(within(keypad).getByRole('button', { name: '2' }));
    expect(dots).toHaveTextContent('كُتب رقمان من أربعة');

    await user.click(within(keypad).getByRole('button', { name: 'امسح رقماً' }));
    expect(dots).toHaveTextContent('كُتب رقم واحد من أربعة');

    await user.keyboard('٣4');
    expect(dots).toHaveTextContent('كُتبت 3 أرقام من أربعة');
  });

  it('sends unknown cashier paths back to the sign-in', async () => {
    await linkDevice();
    renderApp('/pos/sale');

    expect(await screen.findByRole('heading', { name: 'من يعمل الآن؟' })).toBeInTheDocument();
  });

  it('says plainly when no staff reached a newly linked device yet', async () => {
    await deviceStore().putDevice(record);
    renderApp('/pos');

    expect(await screen.findByText('لا أسماء موظفين على هذا الجهاز بعد')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('device record', () => {
  it('moves the step-1 localStorage record into the device database, once', async () => {
    localStorage.setItem(LEGACY_DEVICE_KEY, JSON.stringify(device));
    expect(await loadDevice(deviceStore())).toEqual(record);
    expect(localStorage.getItem(LEGACY_DEVICE_KEY)).toBeNull();
    expect(await deviceStore().getDevice()).toEqual(record);
    expect(await loadDevice(deviceStore())).toEqual(record);
  });

  it('treats a missing, damaged or blocked record as not linked', async () => {
    const store = deviceStore();
    const legacy = (getItem: () => string | null) => ({ getItem, removeItem: () => undefined });
    expect(
      await loadDevice(
        store,
        legacy(() => null),
      ),
    ).toBeNull();
    expect(
      await loadDevice(
        store,
        legacy(() => '{not json'),
      ),
    ).toBeNull();
    expect(
      await loadDevice(
        store,
        legacy(() => JSON.stringify({ storeName: 'x' })),
      ),
    ).toBeNull();
    expect(
      await loadDevice(
        store,
        legacy(() => {
          throw new DOMException('blocked', 'SecurityError');
        }),
      ),
    ).toBeNull();
    const broken = { getDevice: () => Promise.reject(new Error('IndexedDB unavailable')) };
    expect(
      await loadDevice(
        broken as never,
        legacy(() => null),
      ),
    ).toBeNull();
  });

  it('warns in red when the browser refuses to keep the data', async () => {
    await linkDevice();
    const persist = vi.fn(async () => false);
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persisted: async () => false, persist, estimate: async () => ({}) },
    });
    try {
      renderApp('/pos');
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'هذا المتصفح قد يمسح البيانات، ثبّت التطبيق',
      );
      expect(persist).toHaveBeenCalledOnce();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, 'storage');
    }
  });
});
