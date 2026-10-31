import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, posSets, staffServer } from '../../test/pos';
import { renderPos } from '../../test/renderPos';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { checkCode, staffRoster } from './staff';
import { checkPin, FIRST_LOCK_MS, lockDuration, readLockout, rememberPin } from './verifier';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function pick(user: ReturnType<typeof renderPos>['user'], name: string) {
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await user.click(within(list).getByRole('button', { name: new RegExp(name) }));
}

describe('sign-in «من يعمل الآن؟»', () => {
  it('lists the branch staff, then signs in online with the code and opens the shift', async () => {
    const fetch = staffServer();
    const { user } = renderPos({ fetch: fetch as unknown as typeof globalThis.fetch });

    expect(await screen.findByRole('heading', { name: 'من يعمل الآن؟' })).toBeInTheDocument();
    await pick(user, 'سامر');
    expect(screen.getByText('اكتب رمز الدخول من 4 أرقام')).toBeInTheDocument();
    await user.keyboard(PINS[ids.samer]!);

    expect(await screen.findByRole('heading', { name: 'افتح الوردية' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/v1/device/staff-sessions');
    expect((init!.headers as Record<string, string>).Authorization).toMatch(/^Device sdt_/);
    expect(JSON.parse(String(init!.body))).toEqual({ userId: ids.samer, pin: PINS[ids.samer] });
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('shows six dots for a manager, and refuses a wrong code with a shake and the attempts left', async () => {
    const { user } = renderPos();
    await pick(user, 'مريم');
    expect(screen.getByText('اكتب رمز الدخول من 6 أرقام')).toBeInTheDocument();
    await user.keyboard('000000');
    expect(await screen.findByText(/رمز غير صحيح\. بقيت 4 من 5 محاولات/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'افتح الوردية' })).not.toBeInTheDocument();
  });

  it('signs in offline with the code learnt online, and refuses one never seen on this device', async () => {
    const local = memoryLocal();
    const first = renderPos({ local });
    await pick(first.user, 'سامر');
    await first.user.keyboard(PINS[ids.samer]!);
    await screen.findByRole('heading', { name: 'افتح الوردية' });
    first.view.unmount();

    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const second = renderPos({ local, online: false, fetch: fetch as unknown as typeof globalThis.fetch });
    await pick(second.user, 'مريم');
    await second.user.keyboard(PINS[ids.maryam]!);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'لم تدخل على هذا الجهاز من قبل. أول دخول يحتاج الإنترنت، وبعده يفتح دون إنترنت.',
    );

    await pick(second.user, 'سامر');
    await second.user.keyboard(PINS[ids.samer]!);
    expect(await screen.findByRole('heading', { name: 'افتح الوردية' })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says so when no staff reached the device yet', async () => {
    renderPos({ sets: posSets({ users: [] }) });
    expect(await screen.findByText('لا أسماء موظفين على هذا الجهاز بعد')).toBeInTheDocument();
  });

  it('signs out after the idle minutes and keeps the unfinished cart for the next sign-in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const local = memoryLocal();
      await local.set(`shift:${ids.samer}`, {
        key: `shift:${ids.samer}`,
        id: '0192a000-0000-7000-8000-00000000ffff',
        number: 'SFT-001-002-0000001',
        openedBy: ids.samer,
        openedByName: 'سامر',
        openedAt: Date.now(),
        mode: 'per_cashier',
        opening: [{ currency: 'SYP', amountMinor: 0, denominations: null }],
      });
      const { user } = renderPos({ local });
      await pick(user, 'سامر');
      await user.keyboard(PINS[ids.samer]!);
      await user.click(await screen.findByRole('button', { name: /سكر أبيض/ }));
      expect(screen.getByRole('list', { name: 'أسطر الفاتورة' })).toHaveTextContent('سكر أبيض');

      await act(async () => {
        vi.advanceTimersByTime(5 * 60_000 + 10);
      });
      expect(await screen.findByRole('heading', { name: 'من يعمل الآن؟' })).toBeInTheDocument();

      await pick(user, 'سامر');
      await user.keyboard(PINS[ids.samer]!);
      expect(await screen.findByRole('list', { name: 'أسطر الفاتورة' })).toHaveTextContent('سكر أبيض');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the device verifier and lockout (16 › تخمين رمز PIN)', () => {
  const member = () => staffRoster(posSets(), '001').find((m) => m.id === ids.samer)!;

  it('keeps an HMAC per user and PIN version only, and forgets it when the version moves', async () => {
    const local = memoryLocal();
    const profile = { fullName: 'سامر', permissions: [], roles: [], pinLength: 4 as const };
    await rememberPin(local, ids.samer, 1, '2580', profile);
    expect(await checkPin(local, ids.samer, 1, '2580')).toBe('ok');
    expect(await checkPin(local, ids.samer, 1, '2581')).toBe('wrong');
    expect(await checkPin(local, ids.samer, 2, '2580')).toBe('unknown');
    // The device key cannot be read back out of the device.
    const key = await local.get<CryptoKey>('staffKey');
    expect(key?.extractable).toBe(false);
    // What is stored is not the PIN.
    expect(JSON.stringify(await local.get('staffVerifier:' + ids.samer))).not.toContain('2580');
  });

  it('locks a minute after five wrong codes offline, doubling on each failure after that', async () => {
    const local = memoryLocal();
    let now = 1_000_000;
    const deps = { local, token: null, online: false, now: () => now };
    await rememberPin(local, ids.samer, 1, '2580', {
      fullName: 'سامر',
      permissions: [],
      roles: [],
      pinLength: 4,
    });
    for (let i = 1; i <= 4; i++) {
      expect(await checkCode(deps, member(), '1111')).toMatchObject({
        ok: false,
        reason: 'wrong',
        lockedUntil: 0,
      });
    }
    expect(await checkCode(deps, member(), '1111')).toMatchObject({
      reason: 'wrong',
      lockedUntil: now + FIRST_LOCK_MS,
    });
    // Even the right code waits while locked.
    expect(await checkCode(deps, member(), '2580')).toMatchObject({ reason: 'locked' });
    now += FIRST_LOCK_MS + 1;
    expect(await checkCode(deps, member(), '1111')).toMatchObject({ lockedUntil: now + 2 * FIRST_LOCK_MS });
    now += 2 * FIRST_LOCK_MS + 1;
    expect(await checkCode(deps, member(), '2580')).toMatchObject({ ok: true });
    expect(await readLockout(local, ids.samer)).toEqual({ failures: 0, lockedUntil: 0 });
    expect([4, 5, 6, 7].map(lockDuration)).toEqual([0, 60_000, 120_000, 240_000]);
  });

  it('mirrors the server lockout (429 locked with retryAfter)', async () => {
    const local = memoryLocal();
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'locked', retryAfter: 120 } }), { status: 429 }),
    );
    const result = await checkCode(
      {
        local,
        token: 'sdt_x',
        online: true,
        now: () => 5_000,
        fetch: fetch as unknown as typeof globalThis.fetch,
      },
      member(),
      '2580',
    );
    expect(result).toEqual({ ok: false, reason: 'locked', lockedUntil: 125_000 });
    expect((await readLockout(local, ids.samer)).lockedUntil).toBe(125_000);
  });

  it('checks offline when the server does not answer', async () => {
    const local = memoryLocal();
    await rememberPin(local, ids.samer, 1, '2580', {
      fullName: 'سامر',
      permissions: ['sale.create'],
      roles: [],
      pinLength: 4,
    });
    const fetch = vi.fn(async () => new Response('{}', { status: 503 }));
    const result = await checkCode(
      {
        local,
        token: 'sdt_x',
        online: true,
        now: () => 1,
        fetch: fetch as unknown as typeof globalThis.fetch,
      },
      member(),
      '٢٥٨٠',
    );
    expect(result).toMatchObject({ ok: true, session: { userId: ids.samer, offline: true } });
  });

  it('lists only active staff with a code who hold a role in this branch or store-wide', () => {
    const sets = posSets();
    sets.users.push({
      id: 'x',
      fullName: 'بلا رمز',
      status: 'active',
      pinLength: null,
      pinVersion: 0,
      version: 1,
    });
    sets.users.push({
      id: 'y',
      fullName: 'موقوف',
      status: 'disabled',
      pinLength: 4,
      pinVersion: 1,
      version: 1,
    });
    sets.user_roles.push({ id: 'z', userId: 'y', roleId: ids.cashierRole, branchId: null, version: 1 });
    const other = { ...sets, branches: [{ ...sets.branches[0]!, code: '009' }] };
    expect(staffRoster(sets, '001').map((m) => m.fullName)).toEqual(['سامر', 'مريم']);
    expect(staffRoster(other, '009').map((m) => m.fullName)).toEqual(['سامر', 'مريم']);
    expect(
      staffRoster(
        { ...sets, branches: [...sets.branches, { ...sets.branches[0]!, id: 'b2', code: '002' }] },
        '002',
      ).map((m) => m.fullName),
    ).toEqual(['مريم']);
  });
});
