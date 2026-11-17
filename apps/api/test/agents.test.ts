import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  AgentActivation,
  AgentLedgerRow,
  AgentLoginResponse,
  AgentMe,
  AgentStore,
  PlatformAgent,
  PlatformAgentPage,
  PlatformLoginResponse,
  PlatformStore,
  SubscriptionPage,
} from '@serva/core';
import { hashSecret } from '../src/auth/passwords';
import { ManualClock, DAY_MS } from '../src/clock';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, registerStore, resetDatabase } from './helpers';

/**
 * The agents program (contracts/agents.ts; 07 › برنامج الوكلاء): the owner adds agents and tops up
 * their prepaid balance; an agent signs in on his own, sees only his stores and pays for a paid
 * plan from his balance at his wholesale price. The balance never goes below zero, a repeated
 * request is never charged twice, and none of it touches a store's books.
 */

let app: FastifyInstance;
let clock: ManualClock;
beforeAll(async () => {
  clock = new ManualClock();
  app = await makeApp({}, { clock });
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(async () => {
  await resetDatabase();
  clock.set('2026-10-30T09:00:00.000Z');
  await ownerDb()`
    insert into plans (code, name, sort_order, limits, features, price_monthly_minor, price_yearly_minor)
    values ('basic', 'الأساسية', 1, '{}', '{}', 1000, 10000)
    on conflict (code) do update set price_monthly_minor = 1000, price_yearly_minor = 10000, is_active = true`;
});

async function platformAdmin(role: 'super_admin' | 'support' | 'accountant' = 'super_admin') {
  const email = `${role}@serva.test`;
  await ownerDb()`
    insert into platform_users (full_name, email, password_hash, role)
    values ('مدير المنصة', ${email}, ${await hashSecret('platform-pass-1')}, ${role})
    on conflict (email) do nothing`;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/platform/login',
    payload: { email, password: 'platform-pass-1' },
  });
  expect(res.statusCode, res.body).toBe(200);
  return { authorization: `Bearer ${res.json<PlatformLoginResponse>().token}` };
}

const agentBody = (over: Record<string, unknown> = {}) => ({
  code: 'ag-42',
  fullName: 'وكيل الرقة',
  phone: '0944111222',
  email: 'raqqa@agents.test',
  region: 'الرقة',
  status: 'active',
  discountBp: 2000,
  priceOverrides: {},
  note: '',
  password: 'temp-pass-123',
  ...over,
});

async function addAgent(over: Record<string, unknown> = {}): Promise<string> {
  const admin = await platformAdmin();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/platform/agents',
    headers: admin,
    payload: agentBody(over),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>().id;
}

/** A signed-in agent whose temporary password is already changed. */
async function agentSession(email = 'raqqa@agents.test', password = 'temp-pass-123') {
  const login = await app.inject({ method: 'POST', url: '/v1/agent/login', payload: { email, password } });
  expect(login.statusCode, login.body).toBe(200);
  const body = login.json<AgentLoginResponse>();
  const headers = { authorization: `Bearer ${body.token}` };
  if (body.agent.mustChangePassword) {
    const changed = await app.inject({
      method: 'PUT',
      url: '/v1/agent/password',
      headers,
      payload: { current: password, password: 'my-own-pass-1' },
    });
    expect(changed.statusCode, changed.body).toBe(204);
  }
  return headers;
}

async function topUp(agentId: string, amountMinor: number, requestKey = `topup-${Math.random()}-key`) {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/platform/agents/${agentId}/balance`,
    headers: await platformAdmin(),
    payload: { amountMinor, note: 'حوالة شام كاش', requestKey },
  });
  return res;
}

/** A store registered with the agent's code, its trial run out. */
async function storeOf(agentCode: string | undefined, phone: string, trialOver = true) {
  const { body } = await registerStore(app, { phone, ...(agentCode ? { agentCode } : {}) });
  const tenantId = body.tenant.id as string;
  if (trialOver) {
    await ownerDb()`update subscriptions set trial_ends_at = ${new Date(clock.now().getTime() - DAY_MS).toISOString()}
      where tenant_id = ${tenantId}`;
  }
  return { tenantId, accessToken: body.accessToken as string };
}

const activate = (headers: Record<string, string>, tenantId: string, over: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: `/v1/agent/stores/${tenantId}/activate`,
    headers,
    payload: { planCode: 'basic', billingCycle: 'monthly', requestKey: `act-${Math.random()}-key`, ...over },
  });

const me = async (headers: Record<string, string>) =>
  (await app.inject({ method: 'GET', url: '/v1/agent/me', headers })).json<AgentMe>();

describe('the owner adds and edits agents', () => {
  it('adds an agent with an upper-case code, and refuses a repeated code or email', async () => {
    const id = await addAgent();
    const admin = await platformAdmin();
    const list = (await app.inject({ method: 'GET', url: '/v1/platform/agents', headers: admin })).json<{
      items: PlatformAgent[];
    }>();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id,
      code: 'AG-42',
      balanceMinor: 0,
      status: 'active',
      discountBp: 2000,
      hasLogin: true,
      stores: 0,
    });
    // The password never leaves the server
    expect(JSON.stringify(list)).not.toMatch(/temp-pass|password/i);

    const sameCode = await app.inject({
      method: 'POST',
      url: '/v1/platform/agents',
      headers: admin,
      payload: agentBody({ email: 'other@agents.test' }),
    });
    expect(sameCode.statusCode).toBe(400);
    expect(sameCode.json().error.fields.code).toBeTruthy();
    const sameEmail = await app.inject({
      method: 'POST',
      url: '/v1/platform/agents',
      headers: admin,
      payload: agentBody({ code: 'AG-43' }),
    });
    expect(sameEmail.statusCode).toBe(400);
    expect(sameEmail.json().error.fields.email).toBeTruthy();
  });

  it('only the general manager adds or edits; the accountant tops up; support reads', async () => {
    const support = await platformAdmin('support');
    const accountant = await platformAdmin('accountant');
    for (const headers of [support, accountant]) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/platform/agents',
        headers,
        payload: agentBody(),
      });
      expect(res.statusCode).toBe(403);
    }
    const id = await addAgent();
    const key = 'accountant-topup-1';
    const ok = await app.inject({
      method: 'POST',
      url: `/v1/platform/agents/${id}/balance`,
      headers: accountant,
      payload: { amountMinor: 5000, requestKey: key },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/platform/agents/${id}/balance`,
      headers: support,
      payload: { amountMinor: 5000, requestKey: 'support-topup-1' },
    });
    expect(denied.statusCode).toBe(403);
    const read = await app.inject({ method: 'GET', url: `/v1/platform/agents/${id}`, headers: support });
    expect(read.statusCode).toBe(200);
  });

  it('edits prices and suspends; an edit without a password keeps the old one', async () => {
    const id = await addAgent();
    const admin = await platformAdmin();
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/platform/agents/${id}`,
      headers: admin,
      payload: agentBody({
        password: '',
        discountBp: 3000,
        priceOverrides: { basic: { monthly: 700 } },
        status: 'suspended',
      }),
    });
    expect(res.statusCode, res.body).toBe(204);
    const page = (
      await app.inject({ method: 'GET', url: `/v1/platform/agents/${id}`, headers: admin })
    ).json<PlatformAgentPage>();
    expect(page.agent).toMatchObject({
      status: 'suspended',
      discountBp: 3000,
      priceOverrides: { basic: { monthly: 700 } },
    });
    // Suspended: he cannot sign in, even with the password he had
    const login = await app.inject({
      method: 'POST',
      url: '/v1/agent/login',
      payload: { email: 'raqqa@agents.test', password: 'temp-pass-123' },
    });
    expect(login.statusCode).toBe(401);
    // Back to active: the same password still works
    await app.inject({
      method: 'PUT',
      url: `/v1/platform/agents/${id}`,
      headers: admin,
      payload: agentBody({ password: '' }),
    });
    const again = await app.inject({
      method: 'POST',
      url: '/v1/agent/login',
      payload: { email: 'raqqa@agents.test', password: 'temp-pass-123' },
    });
    expect(again.statusCode).toBe(200);
  });
});

describe('the prepaid balance', () => {
  it('tops up into the ledger, once per request key', async () => {
    const id = await addAgent();
    const key = 'topup-key-0001';
    const first = await topUp(id, 10_000, key);
    expect(first.json()).toEqual({ balanceMinor: 10_000, replay: false });
    const second = await topUp(id, 10_000, key);
    expect(second.json()).toEqual({ balanceMinor: 10_000, replay: true });
    // The same key for another amount is a mistake, not a second top-up
    expect((await topUp(id, 20_000, key)).statusCode).toBe(409);
    const page = (
      await app.inject({ method: 'GET', url: `/v1/platform/agents/${id}`, headers: await platformAdmin() })
    ).json<PlatformAgentPage>();
    expect(page.agent.balanceMinor).toBe(10_000);
    expect(page.ledger).toHaveLength(1);
    expect(page.ledger[0]).toMatchObject({
      kind: 'topup',
      amountMinor: 10_000,
      balanceAfterMinor: 10_000,
      note: 'حوالة شام كاش',
    });
  });

  it('a deduction cannot take the balance below zero, and the ledger cannot be edited', async () => {
    const id = await addAgent();
    await topUp(id, 3000);
    expect((await topUp(id, -5000)).statusCode).toBe(409);
    expect((await topUp(id, -1000)).json()).toMatchObject({ balanceMinor: 2000 });
    expect((await topUp(id, 0)).statusCode).toBe(400);
    await expect(ownerDb()`update agent_ledger set amount_minor = 1`).rejects.toThrow(/append-only/);
    await expect(ownerDb()`delete from agent_ledger`).rejects.toThrow(/append-only/);
    await expect(ownerDb()`update agents set balance_minor = -1`).rejects.toThrow(/balance_not_negative/);
  });

  it('twenty top-ups sent at once with one key count once', async () => {
    const id = await addAgent();
    const headers = await platformAdmin();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        app.inject({
          method: 'POST',
          url: `/v1/platform/agents/${id}/balance`,
          headers,
          payload: { amountMinor: 1000, requestKey: 'same-key-for-all' },
        }),
      ),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const [row] = await ownerDb()<
      { balance_minor: string }[]
    >`select balance_minor::text from agents where id = ${id}`;
    expect(row!.balance_minor).toBe('1000');
  });
});

describe('the agent signs in on his own', () => {
  it('the temporary password opens nothing but the change of password', async () => {
    await addAgent();
    const login = await app.inject({
      method: 'POST',
      url: '/v1/agent/login',
      payload: { email: 'raqqa@agents.test', password: 'temp-pass-123' },
    });
    const body = login.json<AgentLoginResponse>();
    expect(body.agent.mustChangePassword).toBe(true);
    const headers = { authorization: `Bearer ${body.token}` };
    expect((await app.inject({ method: 'GET', url: '/v1/agent/stores', headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/v1/agent/me', headers })).statusCode).toBe(200);
    const wrong = await app.inject({
      method: 'PUT',
      url: '/v1/agent/password',
      headers,
      payload: { current: 'not-it-at-all', password: 'my-own-pass-1' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/v1/agent/password',
          headers,
          payload: { current: 'temp-pass-123', password: 'my-own-pass-1' },
        })
      ).statusCode,
    ).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/v1/agent/stores', headers })).statusCode).toBe(200);
    // The old password no longer opens the door, the new one does
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/agent/login',
          payload: { email: 'raqqa@agents.test', password: 'temp-pass-123' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/agent/login',
          payload: { email: 'raqqa@agents.test', password: 'my-own-pass-1' },
        })
      ).json<AgentLoginResponse>().agent.mustChangePassword,
    ).toBe(false);
  });

  it('a wrong password or an unknown email gives the same answer, and many tries are stopped', async () => {
    await addAgent();
    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/agent/login',
      payload: { email: 'raqqa@agents.test', password: 'wrong-wrong' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/agent/login',
      payload: { email: 'nobody@agents.test', password: 'wrong-wrong' },
    });
    expect([wrong.statusCode, unknown.statusCode]).toEqual([401, 401]);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
    expect(wrong.json().error.code).toBe(unknown.json().error.code);
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (
        await app.inject({
          method: 'POST',
          url: '/v1/agent/login',
          payload: { email: 'raqqa@agents.test', password: `wrong-${i}-wrong` },
        })
      ).statusCode;
    }
    expect(last).toBe(429);
    // The right password is refused too while the email is locked out
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/agent/login',
          payload: { email: 'raqqa@agents.test', password: 'temp-pass-123' },
        })
      ).statusCode,
    ).toBe(429);
  });

  it('a suspended agent’s token stops working at once', async () => {
    const id = await addAgent();
    const headers = await agentSession();
    expect((await app.inject({ method: 'GET', url: '/v1/agent/stores', headers })).statusCode).toBe(200);
    await ownerDb()`update agents set status = 'suspended' where id = ${id}`;
    for (const url of ['/v1/agent/stores', '/v1/agent/me', '/v1/agent/ledger']) {
      expect((await app.inject({ method: 'GET', url, headers })).statusCode, url).toBe(401);
    }
  });

  it('a token of another realm opens nothing, in either direction', async () => {
    await addAgent();
    const agentHeaders = await agentSession();
    const store = await registerStore(app, { phone: '0955000001' });
    const platformHeaders = await platformAdmin();
    for (const headers of [{ authorization: `Bearer ${store.body.accessToken}` }, platformHeaders]) {
      expect((await app.inject({ method: 'GET', url: '/v1/agent/stores', headers })).statusCode).toBe(401);
    }
    for (const url of ['/v1/platform/agents', '/v1/platform/stores', '/v1/subscription', '/v1/me']) {
      expect((await app.inject({ method: 'GET', url, headers: agentHeaders })).statusCode, url).toBe(401);
    }
  });
});

describe('an agent’s stores', () => {
  it('a store registered with his code is his, with the state of its subscription and nothing of its business', async () => {
    const id = await addAgent();
    const own = await storeOf('ag-42', '0955000001', false);
    await storeOf(undefined, '0955000002');
    const headers = await agentSession();
    const stores = (await app.inject({ method: 'GET', url: '/v1/agent/stores', headers })).json<{
      items: AgentStore[];
    }>();
    expect(stores.items.map((s) => s.tenantId)).toEqual([own.tenantId]);
    expect(stores.items[0]).toMatchObject({
      status: 'trialing',
      planCode: expect.any(String),
      tenantStatus: 'active',
    });
    expect(Object.keys(stores.items[0]!).sort()).toEqual(
      [
        'billingCycle',
        'createdAt',
        'currentPeriodEnd',
        'graceEndsAt',
        'name',
        'ownerPhone',
        'planCode',
        'planName',
        'status',
        'storeCode',
        'tenantId',
        'tenantStatus',
        'trialEndsAt',
      ].sort(),
    );
    const list = (
      await app.inject({ method: 'GET', url: '/v1/platform/stores', headers: await platformAdmin() })
    ).json<{
      items: PlatformStore[];
    }>();
    expect(list.items.find((s) => s.tenantId === own.tenantId)?.agent).toMatchObject({ id, code: 'AG-42' });
    expect(list.items.find((s) => s.tenantId !== own.tenantId)?.agent).toBeNull();
  });

  it('the store’s owner sees his agent’s name and phone on the subscription page', async () => {
    await addAgent();
    const withAgent = await storeOf('AG-42', '0955000001', false);
    const alone = await storeOf(undefined, '0955000002', false);
    const read = async (s: { accessToken: string }) =>
      (
        await app.inject({
          method: 'GET',
          url: '/v1/subscription',
          headers: { authorization: `Bearer ${s.accessToken}` },
        })
      ).json<SubscriptionPage>().agent;
    expect(await read(withAgent)).toEqual({ fullName: 'وكيل الرقة', phone: '0944111222' });
    expect(await read(alone)).toBeNull();
  });

  it('the owner moves a store to another agent or to nobody', async () => {
    await addAgent();
    const second = await addAgent({ code: 'AG-77', email: 'damascus@agents.test', fullName: 'وكيل دمشق' });
    const store = await storeOf('AG-42', '0955000001', false);
    const admin = await platformAdmin();
    const first = await agentSession();
    const other = await agentSession('damascus@agents.test');
    const names = async (h: Record<string, string>) =>
      (await app.inject({ method: 'GET', url: '/v1/agent/stores', headers: h })).json<{
        items: AgentStore[];
      }>().items.length;
    expect([await names(first), await names(other)]).toEqual([1, 0]);
    const move = (agentId: string | null) =>
      app.inject({
        method: 'PUT',
        url: `/v1/platform/stores/${store.tenantId}/agent`,
        headers: admin,
        payload: { agentId },
      });
    expect((await move(second)).statusCode).toBe(204);
    expect([await names(first), await names(other)]).toEqual([0, 1]);
    expect((await move(null)).statusCode).toBe(204);
    expect([await names(first), await names(other)]).toEqual([0, 0]);
    expect((await move('0192a000-0000-7000-8000-000000000001')).statusCode).toBe(404);
    const logs = await ownerDb()<
      { action: string }[]
    >`select action from platform_audit_logs where action = 'agent.move_store'`;
    expect(logs).toHaveLength(2);
  });
});

describe('an agent activates a store from his balance', () => {
  it('waits for the end of the trial', async () => {
    const id = await addAgent();
    await topUp(id, 5000);
    const store = await storeOf('AG-42', '0955000001', false);
    const res = await activate(await agentSession(), store.tenantId);
    expect(res.statusCode).toBe(409);
    const [row] = await ownerDb()<
      { balance_minor: string }[]
    >`select balance_minor::text from agents where id = ${id}`;
    expect(row!.balance_minor).toBe('5000');
  });

  it('charges the wholesale price, activates the plan and records it on the platform side only', async () => {
    const id = await addAgent();
    await topUp(id, 5000);
    const store = await storeOf('AG-42', '0955000001');
    const headers = await agentSession();
    expect((await me(headers)).plans[0]).toMatchObject({
      code: 'basic',
      monthly: { listMinor: 1000, wholesaleMinor: 800 },
      yearly: { listMinor: 10000, wholesaleMinor: 8000 },
    });
    const res = await activate(headers, store.tenantId, { requestKey: 'first-activation-1' });
    expect(res.statusCode, res.body).toBe(200);
    const done = res.json<AgentActivation>();
    expect(done).toMatchObject({ chargedMinor: 800, balanceAfterMinor: 4200, replay: false });
    expect(new Date(done.periodEnd!).getTime()).toBeGreaterThan(clock.now().getTime() + 27 * DAY_MS);

    const sub = await ownerDb()<{ status: string; code: string; billing_cycle: string }[]>`
      select s.status, p.code, s.billing_cycle from subscriptions s join plans p on p.id = s.plan_id
      where s.tenant_id = ${store.tenantId}`;
    expect(sub[0]).toEqual({ status: 'active', code: 'basic', billing_cycle: 'monthly' });
    const ledger = (await app.inject({ method: 'GET', url: '/v1/agent/ledger', headers })).json<{
      items: AgentLedgerRow[];
    }>().items;
    expect(ledger[0]).toMatchObject({
      kind: 'activation',
      amountMinor: -800,
      balanceAfterMinor: 4200,
      listPriceMinor: 1000,
      planCode: 'basic',
      storeId: store.tenantId,
    });
    expect((await me(headers)).balanceMinor).toBe(4200);
    const audit = await ownerDb()<{ details: { chargedMinor: number } }[]>`
      select details from platform_audit_logs where action = 'agent.activate' and store_id = ${store.tenantId}`;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details.chargedMinor).toBe(800);

    // Nothing reached the store's books or its own invoices
    const [books] = await ownerDb()<{ n: number }[]>`
      select (select count(*) from journal_entries where tenant_id = ${store.tenantId})
           + (select count(*) from subscription_invoices where tenant_id = ${store.tenantId})
           + (select count(*) from subscription_payments where tenant_id = ${store.tenantId}) as n`;
    expect(Number(books!.n)).toBe(0);
  });

  it('a renewal adds a month from the end of the current period', async () => {
    const id = await addAgent();
    await topUp(id, 5000);
    const store = await storeOf('AG-42', '0955000001');
    const headers = await agentSession();
    const first = (await activate(headers, store.tenantId)).json<AgentActivation>();
    const second = (await activate(headers, store.tenantId)).json<AgentActivation>();
    const gap = new Date(second.periodEnd!).getTime() - new Date(first.periodEnd!).getTime();
    expect(gap).toBeGreaterThanOrEqual(28 * DAY_MS);
    expect(gap).toBeLessThanOrEqual(31 * DAY_MS);
    expect(second.balanceAfterMinor).toBe(3400);
  });

  it('his own price for a plan replaces the discount', async () => {
    const id = await addAgent({ priceOverrides: { basic: { monthly: 650 } } });
    await topUp(id, 10_000);
    const store = await storeOf('AG-42', '0955000001');
    const headers = await agentSession();
    expect((await activate(headers, store.tenantId)).json<AgentActivation>().chargedMinor).toBe(650);
    expect(
      (await activate(headers, store.tenantId, { billingCycle: 'yearly' })).json<AgentActivation>()
        .chargedMinor,
    ).toBe(8000);
  });

  it('a repeated request is answered, not charged again', async () => {
    const id = await addAgent();
    await topUp(id, 5000);
    const store = await storeOf('AG-42', '0955000001');
    const headers = await agentSession();
    const key = 'one-tap-one-charge';
    const first = (await activate(headers, store.tenantId, { requestKey: key })).json<AgentActivation>();
    const again = (await activate(headers, store.tenantId, { requestKey: key })).json<AgentActivation>();
    expect(again).toMatchObject({
      chargedMinor: 800,
      balanceAfterMinor: 4200,
      replay: true,
      periodEnd: first.periodEnd,
    });
    // The same key for another plan or cycle is refused, never read as the first
    expect(
      (await activate(headers, store.tenantId, { requestKey: key, billingCycle: 'yearly' })).statusCode,
    ).toBe(409);
    const [row] = await ownerDb()<{ balance_minor: string; n: string }[]>`
      select a.balance_minor::text, (select count(*) from agent_ledger where kind = 'activation')::text as n
      from agents a where id = ${id}`;
    expect(row).toEqual({ balance_minor: '4200', n: '1' });
  });

  it('ten taps at once with one key charge once', async () => {
    const id = await addAgent();
    await topUp(id, 5000);
    const store = await storeOf('AG-42', '0955000001');
    const headers = await agentSession();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => activate(headers, store.tenantId, { requestKey: 'double-tap-key-1' })),
    );
    expect(results.map((r) => r.statusCode)).toEqual(Array(10).fill(200));
    expect(results.filter((r) => !r.json<AgentActivation>().replay)).toHaveLength(1);
    const [row] = await ownerDb()<
      { balance_minor: string }[]
    >`select balance_minor::text from agents where id = ${id}`;
    expect(row!.balance_minor).toBe('4200');
  });

  it('with money for only one, ten different requests at once succeed once and the balance never goes below zero', async () => {
    const id = await addAgent();
    await topUp(id, 900);
    const stores: { tenantId: string; accessToken: string }[] = [];
    for (const phone of ['0955000001', '0955000002', '0955000003', '0955000004']) {
      stores.push(await storeOf('AG-42', phone));
    }
    const headers = await agentSession();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        activate(headers, stores[i % 4]!.tenantId, { requestKey: `race-key-${i}-xx` }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(9);
    const [row] = await ownerDb()<{ balance_minor: string; n: string }[]>`
      select a.balance_minor::text, (select count(*) from agent_ledger where kind = 'activation')::text as n
      from agents a where id = ${id}`;
    expect(row).toEqual({ balance_minor: '100', n: '1' });
    const active = await ownerDb()<
      { n: string }[]
    >`select count(*)::text as n from subscriptions where status = 'active'`;
    expect(active[0]!.n).toBe('1');
  });

  it('refuses when the balance is short and changes nothing', async () => {
    const id = await addAgent();
    await topUp(id, 500);
    const store = await storeOf('AG-42', '0955000001');
    const res = await activate(await agentSession(), store.tenantId);
    expect(res.statusCode).toBe(409);
    const [sub] = await ownerDb()<
      { status: string }[]
    >`select status from subscriptions where tenant_id = ${store.tenantId}`;
    expect(sub!.status).toBe('trialing');
    const [row] = await ownerDb()<{ balance_minor: string; n: string }[]>`
      select balance_minor::text, (select count(*) from agent_ledger where kind = 'activation')::text as n from agents where id = ${id}`;
    expect(row).toEqual({ balance_minor: '500', n: '0' });
  });

  it('refuses a store that is not his, a free plan and an unknown plan', async () => {
    const id = await addAgent();
    await addAgent({ code: 'AG-77', email: 'damascus@agents.test' });
    await topUp(id, 5000);
    const headers = await agentSession();
    const noAgent = await storeOf(undefined, '0955000001');
    const theirs = await storeOf('AG-77', '0955000002');
    for (const store of [noAgent, theirs]) {
      expect((await activate(headers, store.tenantId)).statusCode).toBe(404);
    }
    expect((await activate(headers, '0192a000-0000-7000-8000-000000000001')).statusCode).toBe(404);
    expect((await activate(headers, 'not-an-id')).statusCode).toBe(404);
    const own = await storeOf('AG-42', '0955000003');
    expect((await activate(headers, own.tenantId, { planCode: 'free' })).statusCode).toBe(400);
    expect((await activate(headers, own.tenantId, { planCode: 'nope' })).statusCode).toBe(400);
    const [row] = await ownerDb()<
      { balance_minor: string }[]
    >`select balance_minor::text from agents where id = ${id}`;
    expect(row!.balance_minor).toBe('5000');
  });

  it('a store the platform suspended is refused', async () => {
    const id = await addAgent();
    await topUp(id, 5000);
    const store = await storeOf('AG-42', '0955000001');
    await ownerDb()`update tenants set status = 'suspended' where id = ${store.tenantId}`;
    expect((await activate(await agentSession(), store.tenantId)).statusCode).toBe(409);
  });

  it('a suspended agent cannot activate, even if the database function is called directly', async () => {
    const id = await addAgent();
    await topUp(id, 5000);
    const store = await storeOf('AG-42', '0955000001');
    await ownerDb()`update agents set status = 'suspended' where id = ${id}`;
    await expect(
      ownerDb()`select * from agent_activate(${id}, ${store.tenantId}, 'basic', 'monthly', 'direct-call-key', now())`,
    ).rejects.toThrow(/agent not active/);
  });

  it('agent A cannot read or touch agent B’s stores or balance', async () => {
    const a = await addAgent();
    const b = await addAgent({ code: 'AG-77', email: 'damascus@agents.test' });
    await topUp(a, 5000);
    await topUp(b, 5000);
    const storeB = await storeOf('AG-77', '0955000002');
    const headersA = await agentSession();
    expect((await activate(headersA, storeB.tenantId)).statusCode).toBe(404);
    const seen = (await app.inject({ method: 'GET', url: '/v1/agent/stores', headers: headersA })).json<{
      items: AgentStore[];
    }>();
    expect(seen.items).toEqual([]);
    expect(JSON.stringify(await me(headersA))).not.toContain(b);
    const rows = await ownerDb()<
      { id: string; balance_minor: string }[]
    >`select id, balance_minor::text from agents`;
    expect(rows.find((r) => r.id === b)!.balance_minor).toBe('5000');
    const [sub] = await ownerDb()<
      { status: string }[]
    >`select status from subscriptions where tenant_id = ${storeB.tenantId}`;
    expect(sub!.status).toBe('trialing');
  });
});

describe('the agent’s tables are the platform’s alone', () => {
  it('the store role cannot read agents or the ledger, only call the narrow functions', async () => {
    const reads = await ownerDb()<{ agents: boolean; ledger: boolean; fn: boolean }[]>`
      select has_table_privilege('serva_app', 'agents', 'select') as agents,
             has_table_privilege('serva_app', 'agent_ledger', 'select') as ledger,
             has_function_privilege('public', 'agent_activate(uuid, uuid, text, billing_cycle, text, timestamptz)', 'execute') as fn`;
    expect(reads[0]).toEqual({ agents: false, ledger: false, fn: false });
  });
});
