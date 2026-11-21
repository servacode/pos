import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAgent, PlatformAgentPage } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { renderApp } from '../../test/renderApp';

afterEach(() => sessionStorage.clear());

const agent = (over: Partial<PlatformAgent> = {}): PlatformAgent => ({
  id: 'ag-1',
  code: 'AG-42',
  fullName: 'وكيل الرقة',
  phone: '0944111222',
  email: 'raqqa@agents.test',
  region: 'الرقة',
  status: 'active',
  discountBp: 2000,
  priceOverrides: {},
  balanceMinor: 5000,
  note: null,
  hasLogin: true,
  createdAt: '2026-10-30T09:00:00.000Z',
  stores: 2,
  paying: 1,
  trialing: 1,
  ...over,
});

const platform = {
  'POST /v1/platform/login': {
    status: 200,
    body: {
      token: 'pt',
      expiresAt: '2026-10-30T17:00:00.000Z',
      user: { id: 'a', fullName: 'مدير', role: 'super_admin' },
    },
  },
  'GET /v1/platform/payments?status=pending': { status: 200, body: { items: [] } },
};

async function openAgents(user: ReturnType<typeof renderApp>['user']) {
  await user.type(await screen.findByLabelText('البريد الإلكتروني'), 'admin@serva.test');
  await user.type(screen.getByLabelText('كلمة السر'), 'platform-pass-1');
  await user.click(screen.getByRole('button', { name: 'ادخل' }));
  await user.click(await screen.findByRole('button', { name: 'الوكلاء' }));
}

describe('the platform panel › agents', () => {
  it('lists agents with their balances, and adds one', async () => {
    let items: PlatformAgent[] = [agent()];
    const { requestsTo } = mockFetch({
      ...platform,
      'GET /v1/platform/agents': () => ({ status: 200, body: { items } }),
      'GET /v1/platform/plans': { status: 200, body: { items: [] } },
      'POST /v1/platform/agents': () => {
        items = [
          ...items,
          agent({ id: 'ag-2', code: 'AG-77', fullName: 'وكيل دمشق', balanceMinor: 0, stores: 0 }),
        ];
        return { status: 201, body: { id: 'ag-2' } };
      },
      'GET /v1/platform/agents/ag-2': () => ({
        status: 200,
        body: { agent: items[1]!, stores: [], ledger: [] } satisfies PlatformAgentPage,
      }),
    });
    const { user } = renderApp('/platform');
    await openAgents(user);
    expect(await screen.findByText('وكيل الرقة')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'أضف وكيلاً' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('الاسم'), 'وكيل دمشق');
    await user.type(within(dialog).getByLabelText('الكود'), 'ag-77');
    await user.type(within(dialog).getByLabelText(/كلمة سر مؤقتة/), 'temp-pass-123');
    await user.click(within(dialog).getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByRole('button', { name: /كل الوكلاء/ })).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/platform/agents')[0]!.body).toMatchObject({
      code: 'ag-77',
      fullName: 'وكيل دمشق',
      discountBp: 2000,
      status: 'active',
      password: 'temp-pass-123',
    });
  });

  it('tops up the balance once per attempt, with a key', async () => {
    let balance = 5000;
    const { requestsTo } = mockFetch({
      ...platform,
      'GET /v1/platform/agents': () => ({ status: 200, body: { items: [agent({ balanceMinor: balance })] } }),
      'GET /v1/platform/agents/ag-1': () => ({
        status: 200,
        body: { agent: agent({ balanceMinor: balance }), stores: [], ledger: [] } satisfies PlatformAgentPage,
      }),
      'POST /v1/platform/agents/ag-1/balance': () => {
        balance += 2500;
        return { status: 200, body: { balanceMinor: balance, replay: false } };
      },
    });
    const { user } = renderApp('/platform');
    await openAgents(user);
    await user.click(await screen.findByRole('button', { name: 'افتح' }));
    await user.type(await screen.findByLabelText('المبلغ بالدولار'), '25');
    await user.type(screen.getByLabelText(/ملاحظة/), 'شام كاش 123');
    await user.click(screen.getByRole('button', { name: 'أضف إلى الرصيد' }));
    expect(await screen.findByText('أُضيف المبلغ إلى الرصيد.')).toBeInTheDocument();
    const sent = requestsTo('POST', '/v1/platform/agents/ag-1/balance');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ amountMinor: 2500, note: 'شام كاش 123' });
    expect((sent[0]!.body as { requestKey: string }).requestKey).toMatch(/^plt-/);
  });
});
