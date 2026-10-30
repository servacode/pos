import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { LOCAL_DEVICE_KEY, readLocalDevice, type LocalDevice } from './localDevice';

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

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function linkDevice() {
  localStorage.setItem(LOCAL_DEVICE_KEY, JSON.stringify(device));
}

describe('/pos (cashier)', () => {
  it('boots from the device alone and asks for the login code, with no network request', async () => {
    linkDevice();
    renderApp('/pos');

    expect(await screen.findByRole('heading', { name: 'اكتب رمز الدخول' })).toBeInTheDocument();
    expect(screen.getByText('مقهى الياسمين')).toBeInTheDocument();
    expect(screen.getByText('الرقة · شارع تل أبيض · كاشير 3')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('opens without internet and says so, still with no request', async () => {
    linkDevice();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderApp('/pos');

    await screen.findByRole('heading', { name: 'اكتب رمز الدخول' });
    expect(screen.getByText('دون إنترنت · البيع مستمر')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('tells an unlinked device to be linked first, without calling the server', async () => {
    renderApp('/pos');

    expect(
      await screen.findByRole('heading', { name: 'هذا الجهاز غير مربوط بمتجر بعد' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'لوحة الأرقام' })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps the keypad LTR with 7 8 9 on top, and fills the dots from taps and the keyboard', async () => {
    linkDevice();
    const { user } = renderApp('/pos');

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

  it('sends unknown cashier paths back to the login code', async () => {
    linkDevice();
    renderApp('/pos/sale');

    expect(await screen.findByRole('heading', { name: 'اكتب رمز الدخول' })).toBeInTheDocument();
  });
});

describe('readLocalDevice', () => {
  it('treats a missing, damaged or blocked record as not linked', () => {
    expect(readLocalDevice({ getItem: () => null })).toBeNull();
    expect(readLocalDevice({ getItem: () => '{not json' })).toBeNull();
    expect(readLocalDevice({ getItem: () => JSON.stringify({ storeName: 'x' }) })).toBeNull();
    expect(
      readLocalDevice({
        getItem: () => {
          throw new DOMException('blocked', 'SecurityError');
        },
      }),
    ).toBeNull();
    expect(readLocalDevice({ getItem: () => JSON.stringify(device) })).toEqual(device);
  });
});
