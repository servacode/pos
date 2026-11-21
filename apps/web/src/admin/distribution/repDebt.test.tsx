import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, Permission, RepDebt, RepRow } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';

function meOf(extra: Permission[] = []): MeResponse {
  const base = makeMe({ repsEnabled: true });
  return {
    ...base,
    user: {
      ...base.user,
      permissions: [...base.user.permissions, 'routes.manage', 'rep.settle', 'report.view', ...extra],
    },
  };
}

const rep: RepRow = {
  id: 'rep-1',
  userId: 'u-1',
  userName: 'سمير',
  branchId: 'branch-1',
  branchName: 'الفرع الرئيسي',
  vanBranchId: 'van-1',
  vanName: 'سيارة 1',
  vehiclePlate: null,
  deviceId: null,
  deviceName: null,
  mode: 'van',
  maxDiscountBp: null,
  dailyCreditLimitMinor: null,
  commissionPlanId: null,
  isActive: true,
  note: null,
  routeCount: 1,
  version: 1,
};

const debt = (balanceMinor: number, over: Partial<RepDebt> = {}): RepDebt => ({
  repId: 'rep-1',
  repName: 'سمير',
  baseCurrency: 'SYP',
  balanceMinor,
  entries: [
    {
      id: 'e-1',
      number: '2026-0000042',
      date: '2026-11-17',
      kind: 'shortage',
      amountMinor: 1_000_000,
      memo: 'ذمة على المندوب: عجز التسوية RST-2026-000001',
    },
  ],
  ...over,
});

function open(
  extra: Permission[],
  state: { balance: number },
  extraRoutes: Parameters<typeof mockFetch>[0] = {},
) {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: meOf(extra) },
    'GET /v1/reps': { status: 200, body: [rep] },
    'GET /v1/vans': { status: 200, body: [] },
    'GET /v1/commission-plans': { status: 200, body: [] },
    'GET /v1/rep-debts': () => ({
      status: 200,
      body: state.balance > 0 ? [{ repId: 'rep-1', repName: 'سمير', balanceMinor: state.balance }] : [],
    }),
    'GET /v1/reps/rep-1/debt': () => ({ status: 200, body: debt(state.balance) }),
    ...extraRoutes,
  });
  return { ...mock, ...renderApp('/distribution/reps') };
}

describe('«ذمة المندوب»', () => {
  it('shows on the reps page what each rep owes after a shortage, with how it came about', async () => {
    const { user } = open([], { balance: 1_000_000 });
    const owed = await screen.findByRole('button', { name: /10,000|١٠٬٠٠٠|10٬000/ });
    await user.click(owed);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('عليه الآن')).toBeInTheDocument();
    expect(within(dialog).getByText('عجز في التسوية')).toBeInTheDocument();
    expect(within(dialog).getByText('2026-0000042')).toBeInTheDocument();
    // Settling is the supervisor's; forgiving is the owner's accounting permission, which he does not hold here
    expect(within(dialog).getByRole('button', { name: 'سدّد المندوب' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'أعفِه' })).not.toBeInTheDocument();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('takes a payment into the safe, refuses more than he owes without asking, and shows the new balance', async () => {
    const state = { balance: 1_000_000 };
    const { user, requestsTo } = open([], state, {
      'POST /v1/reps/rep-1/debt/payments': (r: MockRequest) => {
        state.balance -= (r.body as { amountMinor: number }).amountMinor;
        return { status: 200, body: debt(state.balance) };
      },
    });
    await user.click(await screen.findByRole('button', { name: /10,000|١٠٬٠٠٠|10٬000/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: 'سدّد المندوب' }));
    await user.type(within(dialog).getByLabelText('المبلغ'), '20000');
    await user.click(within(dialog).getByRole('button', { name: 'سجّل السداد' }));
    expect(await within(dialog).findByText('المبلغ أكبر من ذمة المندوب.')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/reps/rep-1/debt/payments')).toHaveLength(0);

    const amount = within(dialog).getByLabelText('المبلغ');
    await user.clear(amount);
    await user.type(amount, '4000');
    await user.type(within(dialog).getByLabelText('ملاحظة'), 'دفعة أولى');
    await user.click(within(dialog).getByRole('button', { name: 'سجّل السداد' }));
    await waitFor(() => expect(requestsTo('POST', '/v1/reps/rep-1/debt/payments')).toHaveLength(1));
    expect(requestsTo('POST', '/v1/reps/rep-1/debt/payments')[0]?.body).toEqual({
      amountMinor: 400_000,
      note: 'دفعة أولى',
    });
    expect(await within(dialog).findByRole('button', { name: 'سدّد المندوب' })).toBeInTheDocument();
  });

  it('lets the owner forgive some of it with a reason, and asks for the reason', async () => {
    const state = { balance: 1_000_000 };
    const { user, requestsTo } = open(['accounting.post'], state, {
      'POST /v1/reps/rep-1/debt/forgive': (r: MockRequest) => {
        state.balance -= (r.body as { amountMinor: number }).amountMinor;
        return { status: 200, body: debt(state.balance) };
      },
    });
    await user.click(await screen.findByRole('button', { name: /10,000|١٠٬٠٠٠|10٬000/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: 'أعفِه' }));
    await user.type(within(dialog).getByLabelText('المبلغ'), '1000');
    await user.click(within(dialog).getByRole('button', { name: 'أعفِه' }));
    expect(await within(dialog).findByText('اكتب سبب الإعفاء.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('سبب الإعفاء'), 'ظرف خاص');
    await user.click(within(dialog).getByRole('button', { name: 'أعفِه' }));
    await waitFor(() => expect(requestsTo('POST', '/v1/reps/rep-1/debt/forgive')).toHaveLength(1));
    expect(requestsTo('POST', '/v1/reps/rep-1/debt/forgive')[0]?.body).toEqual({
      amountMinor: 100_000,
      reason: 'ظرف خاص',
    });
  });

  it('says «لا شيء» for a rep who owes nothing, and still opens his page', async () => {
    open([], { balance: 0 });
    expect(await screen.findByText('سمير')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'لا شيء' })).toBeInTheDocument();
  });
});
