import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, posSets, PRODUCTS, staffServer } from '../../test/pos';
import { openShift, renderPos } from '../../test/renderPos';
import { showsWaste, wasteQtyOf } from './waste';

/** Round 38, #41: «تالف / هدر» at the till */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('who sees the button, and what a quantity may be', () => {
  it('shows for the stores that throw food away, or any store that set its reasons', () => {
    expect(showsWaste(['supermarket'], null)).toBe(true);
    expect(showsWaste(['bakery', 'cafe'], null)).toBe(true);
    expect(showsWaste(['clothing'], null)).toBe(false);
    expect(
      showsWaste(['clothing'], { returnWindowDays: null, cardApprovalRequired: false, wasteReasons: ['x'] }),
    ).toBe(true);
    expect(showsWaste(undefined, null)).toBe(false);
  });

  it('reads whole pieces for a piece item and up to three decimals for a weighed one', () => {
    expect(wasteQtyOf('2', false)).toBe(2000);
    expect(wasteQtyOf('2.5', false)).toBeNull();
    expect(wasteQtyOf('2.5', true)).toBe(2500);
    expect(wasteQtyOf('٣', false)).toBe(3000);
    expect(wasteQtyOf('0', false)).toBeNull();
    expect(wasteQtyOf('', true)).toBeNull();
  });
});

describe('the waste panel', () => {
  const placed = (id: string) =>
    new Response(
      JSON.stringify({
        id,
        number: 'STK-2026-000007',
        date: '2026-11-19',
        branchId: 'b',
        lines: [],
        diffValueMinor: -50_000,
        baseCurrency: 'SYP',
      }),
      { status: 201 },
    );

  function marketSets(till: Record<string, unknown> | null = null) {
    const sets = posSets();
    sets.settings = sets.settings.map((s) => ({
      ...s,
      sectors: ['supermarket'],
      ...(till ? { till } : {}),
    })) as typeof sets.settings;
    // The store's manager may adjust stock (a cashier may not)
    sets.roles = sets.roles.map((r) =>
      r.key === 'manager' ? { ...r, permissions: [...r.permissions, 'inventory.adjust'] } : r,
    );
    return sets;
  }

  function server(sets: ReturnType<typeof posSets>, answer: (body: Record<string, unknown>) => Response) {
    const staff = staffServer(sets);
    const bodies: Record<string, unknown>[] = [];
    const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/v1/device/waste') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        return answer(body);
      }
      return staff(url, init);
    });
    return { fetch: fn as unknown as typeof fetch, bodies };
  }

  async function open(user: ReturnType<typeof renderPos>['user'], who: 'سامر' | 'مريم', pin: string) {
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(list).getByRole('button', { name: new RegExp(who) }));
    await user.keyboard(pin);
    await screen.findByRole('list', { name: 'الأصناف' });
    await user.click(await screen.findByRole('button', { name: 'أدوات الفاتورة' }));
    await user.click(await screen.findByRole('menuitem', { name: 'تالف / هدر' }));
    return screen.findByRole('region', { name: 'تالف / هدر' });
  }

  it('a cashier picks the item, the quantity and the reason, then a manager’s code signs it; the request carries its own id', async () => {
    const local = memoryLocal();
    await openShift(local);
    const sets = marketSets();
    const { fetch, bodies } = server(sets, (b) => placed(String(b.id)));
    const { user } = renderPos({ local, fetch, sets });
    const panel = await open(user, 'سامر', PINS[ids.samer]!);

    await user.type(within(panel).getByLabelText('الصنف'), PRODUCTS.milk.barcode!.code);
    await user.keyboard('{Enter}');
    const qty = await within(panel).findByLabelText('الكمية');
    await user.clear(qty);
    await user.type(qty, '2');
    // The built-in reasons are offered until the store writes its own
    await user.selectOptions(within(panel).getByLabelText('السبب'), 'انكسر');
    await user.click(within(panel).getByRole('button', { name: 'سجّل التالف برمز مدير' }));
    // Nothing is sent before the manager's code
    expect(bodies).toEqual([]);
    expect(await screen.findByRole('region', { name: 'رمز المدير' })).toHaveTextContent(
      'تسجيل التالف يحتاج رمز مدير',
    );
    await user.keyboard(PINS[ids.maryam]!);

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(await screen.findByText(/سُجّل التالف \(انكسر\) بالرقم STK-2026-000007/)).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      actorId: ids.maryam,
      reason: 'انكسر',
      lines: [{ variantId: PRODUCTS.milk.variant.id, qty: 2000 }],
    });
    expect(bodies[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('offers the reasons the store defined, in their order', async () => {
    const local = memoryLocal();
    await openShift(local);
    const sets = marketSets({
      returnWindowDays: null,
      cardApprovalRequired: false,
      wasteReasons: ['سرقة', 'تنظيف'],
    });
    const { fetch } = server(sets, (b) => placed(String(b.id)));
    const { user } = renderPos({ local, fetch, sets });
    const panel = await open(user, 'سامر', PINS[ids.samer]!);
    const options = within(within(panel).getByLabelText('السبب')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['سرقة', 'تنظيف']);
  });

  it('says it needs the server when offline, and sends nothing', async () => {
    const local = memoryLocal();
    await openShift(local, ids.maryam);
    const sets = marketSets();
    const { fetch, bodies } = server(sets, (b) => placed(String(b.id)));
    const { user, setOnline } = renderPos({ local, fetch, sets });
    const panel = await open(user, 'مريم', PINS[ids.maryam]!);
    await user.type(within(panel).getByLabelText('الصنف'), PRODUCTS.milk.barcode!.code);
    await user.keyboard('{Enter}');
    await within(panel).findByLabelText('الكمية');
    setOnline(false);
    // A holder of the permission signs it herself: no code
    await user.click(within(panel).getByRole('button', { name: 'سجّل التالف' }));
    expect(await within(panel).findByText(/يحتاج اتصالاً بالخادم/)).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('sends the same id again after a lost answer, so nothing is written off twice', async () => {
    const local = memoryLocal();
    await openShift(local, ids.maryam);
    const sets = marketSets();
    sets.roles = sets.roles.map((r) =>
      r.key === 'manager' ? { ...r, permissions: [...r.permissions, 'inventory.adjust'] } : r,
    );
    let first = true;
    const { fetch, bodies } = server(sets, (b) => {
      if (first) {
        first = false;
        return new Response('oops', { status: 502 });
      }
      return placed(String(b.id));
    });
    const { user } = renderPos({ local, fetch, sets });
    const panel = await open(user, 'مريم', PINS[ids.maryam]!);
    await user.type(within(panel).getByLabelText('الصنف'), PRODUCTS.milk.barcode!.code);
    await user.keyboard('{Enter}');
    await within(panel).findByLabelText('الكمية');
    await user.click(within(panel).getByRole('button', { name: 'سجّل التالف' }));
    expect(await within(panel).findByText(/لن يُسجَّل التالف مرتين/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'سجّل التالف' }));
    expect(await screen.findByText(/سُجّل التالف/)).toBeInTheDocument();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.id).toBe(bodies[0]!.id);
  });

  it('is not in the tools of a store that is not a supermarket', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user } = renderPos({ local });
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(list).getByRole('button', { name: /سامر/ }));
    await user.keyboard(PINS[ids.samer]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    expect(screen.queryByRole('button', { name: 'أدوات الفاتورة' })).not.toBeInTheDocument();
  });
});
