import { sql } from 'drizzle-orm';
import type {
  AgentActivation,
  AgentLedgerRow,
  AgentLoginResponse,
  AgentMe,
  AgentStore,
  BillingCycle,
  PlatformAgent,
  PlatformAgentPage,
  PriceOverrides,
} from '@serva/core';
import { normalizePhone, wholesalePrice, type AgentLoginResult, type agentInput } from '@serva/core';
import { uuidv7, type Database } from '@serva/db';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { hashOtp, isTestMode, newOtpCode, OtpDeliveryError } from '../auth/otp';
import {
  AGENT_DEVICE_TTL_SECONDS,
  AGENT_TOKEN_TTL_SECONDS,
  signAgentDeviceToken,
  signAgentToken,
  verifyAgentDeviceToken,
  type PlatformClaims,
} from '../auth/tokens';
import { AppError } from '../errors';
import { effectiveStatus } from './billing';

/**
 * The agents program, platform side (migration 0072; 07 › برنامج الوكلاء). The owner adds agents,
 * sets their wholesale prices and tops up their prepaid balance; an agent signs in on his own, sees
 * only his stores' subscription state and pays for a paid plan from his balance. All money here is
 * the platform's own ledger (agent_ledger), never a store's books. Every write is a database
 * function that locks the agent's row, so the balance cannot go below zero or be charged twice.
 */

const iso = (v: string | Date | null) => (v === null ? null : new Date(v).toISOString());
const signInFailed = () => new AppError(401, 'invalid_credentials', 'البريد أو كلمة السر غير صحيحة.');
const notFound = () => new AppError(404, 'not_found', 'غير موجود.');
const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'validation_failed', message, fields);

/** What the database function said, in the words the screen shows. */
function fromDb(error: unknown): never {
  const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined;
  const message = `${error instanceof Error ? error.message : ''} ${cause?.message ?? ''}`;
  const code = (cause as { code?: string } | undefined)?.code ?? (error as { code?: string }).code;
  const constraint = (cause as { constraint_name?: string } | undefined)?.constraint_name;
  if (code === '23505' && constraint === 'agents_code_unique') {
    throw badRequest('هذا الكود لوكيل آخر.', { code: 'اختر كوداً آخر' });
  }
  if (code === '23505' && constraint === 'agents_email_unique') {
    throw badRequest('هذا البريد لوكيل آخر.', { email: 'اختر بريداً آخر' });
  }
  if (message.includes('key reused')) {
    throw new AppError(409, 'conflict', 'هذا الطلب سبق إرساله بتفاصيل مختلفة. أعد المحاولة من البداية.');
  }
  if (message.includes('insufficient balance')) {
    throw new AppError(409, 'conflict', 'الرصيد لا يكفي لهذه العملية.');
  }
  if (message.includes('trial still running')) {
    throw new AppError(409, 'conflict', 'التجربة المجانية لهذا المتجر ما زالت جارية. فعّله بعد انتهائها.');
  }
  if (message.includes('not your store') || message.includes('unknown store')) throw notFound();
  if (message.includes('store is suspended')) {
    throw new AppError(409, 'conflict', 'هذا المتجر موقوف من المنصة. تواصل مع الإدارة.');
  }
  if (message.includes('agent not active')) {
    throw new AppError(403, 'forbidden', 'حساب الوكيل موقوف. تواصل مع الإدارة.');
  }
  if (
    message.includes('unknown plan') ||
    message.includes('has no price') ||
    message.includes('price is not set')
  ) {
    throw badRequest('هذه الباقة غير متاحة للتفعيل.', { planCode: 'اختر باقة أخرى' });
  }
  if (message.includes('unknown agent')) throw notFound();
  throw error;
}

type AgentDb = {
  id: string;
  code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  region: string | null;
  status: PlatformAgent['status'];
  discount_bp: number;
  price_overrides: PriceOverrides;
  balance_minor: string;
  note: string | null;
  has_login: boolean;
  created_at: string;
  stores: string;
  paying: string;
  trialing: string;
};

const agentRow = (a: AgentDb): PlatformAgent => ({
  id: a.id,
  code: a.code,
  fullName: a.full_name,
  phone: a.phone,
  email: a.email,
  region: a.region,
  status: a.status,
  discountBp: a.discount_bp,
  priceOverrides: a.price_overrides ?? {},
  balanceMinor: Number(a.balance_minor),
  note: a.note,
  hasLogin: a.has_login,
  createdAt: iso(a.created_at)!,
  stores: Number(a.stores),
  paying: Number(a.paying),
  trialing: Number(a.trialing),
});

async function allAgents(db: Database): Promise<PlatformAgent[]> {
  const rows = await db.execute<AgentDb>(sql`
    select id, code, full_name, phone, email, region, status, discount_bp, price_overrides,
           balance_minor::text, note, has_login, created_at, stores::text, paying::text, trialing::text
    from platform_agents()`);
  return rows.map(agentRow);
}

export async function platformAgents(db: Database): Promise<{ items: PlatformAgent[] }> {
  return { items: await allAgents(db) };
}

export async function agentStores(db: Database, agentId: string, now: Date): Promise<AgentStore[]> {
  const rows = await db.execute<{
    tenant_id: string;
    name: string;
    store_code: string;
    owner_phone: string | null;
    created_at: string;
    tenant_status: AgentStore['tenantStatus'];
    plan_code: string | null;
    plan_name: string | null;
    status: AgentStore['status'];
    billing_cycle: BillingCycle | null;
    trial_ends_at: string | null;
    current_period_end: string | null;
    grace_ends_at: string | null;
    grace_days: number | null;
    updated_at: string | null;
  }>(sql`select * from agent_stores(${agentId}::uuid)`);
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    name: r.name,
    storeCode: r.store_code,
    ownerPhone: r.owner_phone,
    createdAt: iso(r.created_at)!,
    tenantStatus: r.tenant_status,
    planCode: r.plan_code,
    planName: r.plan_name,
    status: effectiveStatus(r, now),
    billingCycle: r.billing_cycle,
    trialEndsAt: iso(r.trial_ends_at),
    currentPeriodEnd: iso(r.current_period_end),
    graceEndsAt: iso(r.grace_ends_at),
  }));
}

export async function agentLedger(db: Database, agentId: string, limit = 200): Promise<AgentLedgerRow[]> {
  const rows = await db.execute<{
    id: string;
    kind: AgentLedgerRow['kind'];
    amount_minor: string;
    balance_after_minor: string;
    store_id: string | null;
    store_name: string | null;
    plan_code: string | null;
    billing_cycle: BillingCycle | null;
    list_price_minor: string | null;
    note: string | null;
    created_at: string;
  }>(sql`select id, kind, amount_minor::text, balance_after_minor::text, store_id, store_name, plan_code,
                billing_cycle, list_price_minor::text, note, created_at
         from agent_ledger_rows(${agentId}::uuid, ${limit})`);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    amountMinor: Number(r.amount_minor),
    balanceAfterMinor: Number(r.balance_after_minor),
    storeId: r.store_id,
    storeName: r.store_name,
    planCode: r.plan_code,
    billingCycle: r.billing_cycle,
    listPriceMinor: r.list_price_minor === null ? null : Number(r.list_price_minor),
    note: r.note,
    createdAt: iso(r.created_at)!,
  }));
}

export async function platformAgentPage(db: Database, id: string, now: Date): Promise<PlatformAgentPage> {
  const agent = (await allAgents(db)).find((a) => a.id === id);
  if (!agent) throw notFound();
  return { agent, stores: await agentStores(db, id, now), ledger: await agentLedger(db, id) };
}

/** Money and prices are the general manager's; the platform accountant tops up. Support reads only. */
export function mayChangeAgents(claims: PlatformClaims): void {
  if (claims.role !== 'super_admin') throw new AppError(403, 'forbidden', 'الوكلاء وأسعارهم للمدير العام.');
}
export function mayChangeBalance(claims: PlatformClaims): void {
  if (claims.role === 'support') throw new AppError(403, 'forbidden', 'شحن الرصيد للمدير أو المحاسب.');
}

export async function saveAgent(
  app: FastifyInstance,
  claims: PlatformClaims,
  id: string | null,
  input: z.output<typeof agentInput>,
): Promise<string> {
  mayChangeAgents(claims);
  const passwordHash = input.password ? await app.passwords.hash(input.password) : null;
  const [row] = await app.db
    .execute<{ id: string }>(
      sql`select platform_agent_save(${id}::uuid, ${input.code}, ${input.fullName}, ${input.phone}, ${input.email},
            ${input.region}, ${input.status}::agent_status, ${input.discountBp}::integer,
            ${JSON.stringify(input.priceOverrides)}::jsonb, ${input.note}, ${passwordHash}, ${claims.platformUserId}::uuid) as id`,
    )
    .catch(fromDb);
  return row!.id;
}

export async function changeAgentBalance(
  db: Database,
  claims: PlatformClaims,
  agentId: string,
  input: { amountMinor: number; note: string; requestKey: string },
  now: Date,
): Promise<{ balanceMinor: number; replay: boolean }> {
  mayChangeBalance(claims);
  const [row] = await db
    .execute<{ balance_minor: string; replay: boolean }>(
      sql`select balance_minor::text, replay from platform_agent_balance_change(${agentId}::uuid, ${input.amountMinor}::bigint,
            ${input.note}, ${input.requestKey}, ${claims.platformUserId}::uuid, ${now.toISOString()}::timestamptz)`,
    )
    .catch(fromDb);
  return { balanceMinor: Number(row!.balance_minor), replay: row!.replay };
}

export async function moveStore(
  db: Database,
  claims: PlatformClaims,
  tenantId: string,
  agentId: string | null,
): Promise<void> {
  mayChangeAgents(claims);
  await db
    .execute(
      sql`select platform_agent_move_store(${tenantId}::uuid, ${agentId}::uuid, ${claims.platformUserId}::uuid)`,
    )
    .catch(fromDb);
}

// ─── The agent himself ───────────────────────────────────────────────────────

const CODE_TTL_SECONDS = 600;
const MAX_CODE_ATTEMPTS = 5;
const codeUnavailable = () =>
  new AppError(503, 'unavailable', 'لا يمكن إرسال رمز التحقق الآن. حاول بعد قليل أو تواصل مع الإدارة.');
const wrongCode = () =>
  new AppError(400, 'otp_invalid', 'الرمز غير صحيح. تأكد منه وأعد المحاولة.', {
    code: 'الرمز غير صحيح. تأكد منه وأعد المحاولة.',
  });

/**
 * Step 1 of the agent's sign-in (round 37, decision 21): email and password, like the platform's first step.
 * A suspended agent or an unknown email looks the same. When the password is right a one-time code goes to his
 * phone by the mechanism owners use for sign-up and password recovery, and nothing opens until it is typed
 * (agentSignInCode). An agent with no phone number saved cannot get a code, so he is told to ask the
 * administration, never let in without one.
 */
export async function agentSignIn(
  app: FastifyInstance,
  input: { email: string; password: string; deviceToken?: string | undefined },
  now: Date,
  meta: { ip: string | null } = { ip: null },
): Promise<AgentLoginResult> {
  const { db, passwords } = app;
  const [found] = await db.execute<{
    id: string;
    full_name: string;
    code: string;
    password_hash: string;
    status: 'active' | 'suspended';
    must_change_password: boolean;
  }>(sql`select * from agent_for_login(${input.email})`);
  if (!found || found.status !== 'active') {
    await passwords.verifyAgainstDummy(input.password);
    throw signInFailed();
  }
  if (!(await passwords.verify(found.password_hash, input.password))) throw signInFailed();
  // «تذكّر هالجهاز»: a device he asked to remember skips the code, after the password, while its token is good
  if (input.deviceToken && (await rememberedDevice(app, found.id, input.deviceToken, now))) {
    return openPortal(app, found.id, now, false);
  }
  const [session] = await db.execute<{ phone: string | null }>(
    sql`select phone from agent_session(${found.id}::uuid)`,
  );
  const phone = session?.phone ? normalizePhone(session.phone) : null;
  if (!phone) {
    throw new AppError(
      403,
      'forbidden',
      'لا يوجد رقم جوال محفوظ لحسابك لإرسال رمز الدخول. اطلب من إدارة سيرفا إضافته ثم أعد المحاولة.',
    );
  }
  const { env, otpSender, log } = app;
  if (!otpSender) throw codeUnavailable();
  const challengeId = uuidv7();
  const code = newOtpCode();
  await db.execute(sql`select otp_create(
    ${challengeId}::uuid, 'agent_login', ${phone}, ${hashOtp(env.JWT_SECRET, challengeId, code)},
    ${JSON.stringify({ agentId: found.id })}::jsonb,
    ${new Date(now.getTime() + CODE_TTL_SECONDS * 1000).toISOString()}::timestamptz,
    ${meta.ip}, ${now.toISOString()}::timestamptz)`);
  try {
    await otpSender.send({ phone, code, purpose: 'agent_login' });
  } catch (error) {
    if (!(error instanceof OtpDeliveryError)) throw error;
    log.warn({ err: error.name }, 'agent sign-in code was not delivered');
    throw codeUnavailable();
  }
  return {
    step: 'code',
    challengeId,
    expiresIn: CODE_TTL_SECONDS,
    phoneHint: `${phone.slice(-3)}••••`,
    ...(isTestMode(env) ? { testCode: code } : {}),
  };
}

/** Step 2: the code (single use, five tries, ten minutes) opens the portal, if the agent is still active. */
export async function agentSignInCode(
  app: FastifyInstance,
  input: { challengeId: string; code: string; remember?: boolean | undefined },
  now: Date,
): Promise<AgentLoginResponse> {
  const { db, env } = app;
  const [result] = await db.execute<{ status: string; payload: { agentId?: string } | null }>(
    sql`select status, payload from otp_consume(${input.challengeId}::uuid, 'agent_login',
      ${hashOtp(env.JWT_SECRET, input.challengeId, input.code)}, ${MAX_CODE_ATTEMPTS}, ${now.toISOString()}::timestamptz)`,
  );
  if (result?.status === 'locked') {
    throw new AppError(429, 'locked', 'محاولات خاطئة كثيرة. ادخل من جديد لتطلب رمزاً جديداً.');
  }
  if (result?.status === 'expired') {
    throw new AppError(400, 'otp_invalid', 'انتهت صلاحية الرمز. ادخل من جديد لتطلب رمزاً جديداً.', {
      code: 'انتهت صلاحية الرمز. ادخل من جديد لتطلب رمزاً جديداً.',
    });
  }
  const agentId = result?.status === 'ok' ? result.payload?.agentId : undefined;
  if (!agentId) throw wrongCode();
  return openPortal(app, agentId, now, input.remember === true);
}

/** A device token that is his, not expired, and of the number his account holds now (a suspension or a new password moves it) */
async function rememberedDevice(
  app: FastifyInstance,
  agentId: string,
  token: string,
  now: Date,
): Promise<boolean> {
  const claims = await verifyAgentDeviceToken(token, app.tokenKeys, now);
  if (!claims || claims.agentId !== agentId) return false;
  const [row] = await app.db.execute<{ epoch: number | null }>(
    sql`select agent_device_epoch(${agentId}::uuid) as epoch`,
  );
  return row?.epoch === claims.epoch;
}

/** The portal's session for an agent who passed every step; with `remember`, also the token this device keeps for 30 days */
async function openPortal(
  app: FastifyInstance,
  agentId: string,
  now: Date,
  remember: boolean,
): Promise<AgentLoginResponse> {
  const { db } = app;
  // He may have been suspended since the code was sent
  const [found] = await db.execute<{
    id: string;
    full_name: string;
    code: string;
    must_change_password: boolean;
  }>(sql`select id, full_name, code, must_change_password from agent_session(${agentId}::uuid)`);
  if (!found) throw signInFailed();
  let device: { deviceToken: string; deviceExpiresAt: string } | undefined;
  if (remember) {
    const [row] = await db.execute<{ epoch: number | null }>(
      sql`select agent_device_epoch(${agentId}::uuid) as epoch`,
    );
    if (row?.epoch !== null && row?.epoch !== undefined) {
      device = {
        deviceToken: await signAgentDeviceToken({ agentId, epoch: row.epoch }, app.tokenKeys, now),
        deviceExpiresAt: new Date(now.getTime() + AGENT_DEVICE_TTL_SECONDS * 1000).toISOString(),
      };
    }
  }
  return {
    token: await signAgentToken({ agentId: found.id }, app.tokenKeys, now),
    expiresAt: new Date(now.getTime() + AGENT_TOKEN_TTL_SECONDS * 1000).toISOString(),
    agent: {
      id: found.id,
      fullName: found.full_name,
      code: found.code,
      mustChangePassword: found.must_change_password,
    },
    ...device,
  };
}

export async function changeAgentPassword(
  app: FastifyInstance,
  agentId: string,
  input: { current: string; password: string },
): Promise<void> {
  const [row] = await app.db.execute<{ hash: string | null }>(
    sql`select agent_password_hash(${agentId}::uuid) as hash`,
  );
  if (!row?.hash || !(await app.passwords.verify(row.hash, input.current))) {
    throw badRequest('كلمة السر الحالية غير صحيحة.', { current: 'غير صحيحة' });
  }
  if (input.current === input.password) {
    throw badRequest('اختر كلمة سر جديدة تختلف عن الحالية.', { password: 'اختر كلمة سر جديدة' });
  }
  await app.db
    .execute(sql`select agent_password_set(${agentId}::uuid, ${await app.passwords.hash(input.password)})`)
    .catch(fromDb);
}

/** His balance and the wholesale price of every paid plan for him, beside its list price. */
export async function agentMe(
  db: Database,
  agent: {
    agentId: string;
    fullName: string;
    code: string;
    phone: string | null;
    mustChangePassword: boolean;
  },
): Promise<AgentMe> {
  const [row] = await db.execute<{
    balance_minor: string;
    discount_bp: number;
    price_overrides: PriceOverrides;
  }>(
    sql`select balance_minor::text, discount_bp, price_overrides from platform_agents() where id = ${agent.agentId}::uuid`,
  );
  if (!row) throw notFound();
  const plans = await db.execute<{
    code: string;
    name: string;
    price_monthly_minor: string | null;
    price_yearly_minor: string | null;
  }>(sql`
    select code, name, price_monthly_minor::text, price_yearly_minor::text from plans
    where is_active and not is_free order by sort_order, code`);
  const price = (list: string | null, over: number | undefined) =>
    list === null || Number(list) <= 0
      ? null
      : { listMinor: Number(list), wholesaleMinor: wholesalePrice(Number(list), row.discount_bp, over) };
  return {
    id: agent.agentId,
    fullName: agent.fullName,
    code: agent.code,
    phone: agent.phone,
    balanceMinor: Number(row.balance_minor),
    mustChangePassword: agent.mustChangePassword,
    plans: plans
      .map((p) => ({
        code: p.code,
        name: p.name,
        monthly: price(p.price_monthly_minor, row.price_overrides?.[p.code]?.monthly),
        yearly: price(p.price_yearly_minor, row.price_overrides?.[p.code]?.yearly),
      }))
      .filter((p) => p.monthly || p.yearly),
  };
}

export async function activateStore(
  db: Database,
  agentId: string,
  tenantId: string,
  input: { planCode: string; billingCycle: BillingCycle; requestKey: string },
  now: Date,
): Promise<AgentActivation> {
  const [row] = await db
    .execute<{
      charged_minor: string;
      balance_after_minor: string;
      period_end: string | null;
      replay: boolean;
    }>(
      sql`select charged_minor::text, balance_after_minor::text, period_end, replay
          from agent_activate(${agentId}::uuid, ${tenantId}::uuid, ${input.planCode}, ${input.billingCycle}::billing_cycle,
            ${input.requestKey}, ${now.toISOString()}::timestamptz)`,
    )
    .catch(fromDb);
  return {
    chargedMinor: Number(row!.charged_minor),
    balanceAfterMinor: Number(row!.balance_after_minor),
    periodEnd: iso(row!.period_end),
    replay: row!.replay,
  };
}
