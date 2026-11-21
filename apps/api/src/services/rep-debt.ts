import { sql } from 'drizzle-orm';
import {
  roundDiv,
  toBase,
  type CurrencyCode,
  type RepDebt,
  type RepDebtBalance,
  type RepDebtEntry,
  type RepDebtForgiveInput,
  type RepDebtKind,
  type RepDebtPaymentInput,
  type SettlementRepDebt,
  type TradeRate,
} from '@serva/core';
import { withTenant, type Database, type Transaction } from '@serva/db';
import { inScope, permissionScope, requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { baseCurrencyOf } from './contracts-common';
import { postEntry, type DraftLine } from './posting';
import { assertRepsEnabled } from './subscription-gate';

/**
 * «ذمة المندوب» (round 35, D6). A cash shortage the supervisor finds at the evening settlement is the
 * rep's debt, not the shop's cash-difference loss. The shift close already booked what the rep's own
 * drawer was short (Dr 6200 / Cr 1110); approving the settlement MOVES that amount, it does not add to it:
 *
 *   Dr 1250 ذمم وسلف الموظفين (party: the rep's user)   the shortage, in the base currency
 *     Cr 6200 فروقات الصندوق                             what the shift close booked as that loss
 *     Cr 1110 the drawer of the currency                  what the supervisor found missing beyond it
 *
 * so the loss is never counted twice and the trial balance never moves. Old settlements, and shift
 * closes, post exactly as before. What the rep pays back is Dr 1120 (the safe) / Cr 1250; what the owner
 * forgives is Dr 6200 / Cr 1250 (the loss it was moved from). The rep's balance is the sum of his lines in
 * 1250, as a customer's is in 1200.
 */

const conflict = (message: string) => new AppError(409, 'conflict', message);
const notFound = () => new AppError(404, 'not_found', 'هذا المندوب غير موجود.');

/** Account 1250 as the chart names it, whatever the party */
const STAFF_ACCOUNT = '1250';

export interface RepShortageSource {
  tenantId: string;
  settlementId: string;
  settlementNumber: string;
  businessDate: string;
  /** The books the loss was booked in: the van's branch */
  branchId: string;
  repUserId: string;
  shiftIds: readonly string[];
  /** counted − expected per currency; a negative one is a shortage */
  cashDifference: Record<string, number>;
  baseCurrency: CurrencyCode;
}

const uuidList = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/** The newest known rate of a currency against the base one, for a shortage the shift close did not book */
async function rateOf(tx: Transaction, currency: CurrencyCode, base: CurrencyCode): Promise<TradeRate> {
  const [row] = await tx.execute<{ unit: string; quote: string; rate: string }>(sql`
    select unit, quote, rate::text from exchange_rates
    where unit = ${currency} and quote = ${base}
    order by effective_at desc, id desc limit 1`);
  if (!row) throw conflict(`لا يوجد سعر صرف لـ ${currency}: اضبطه ثم اعتمد التسوية.`);
  return row as unknown as TradeRate;
}

/**
 * Moves the settlement's cash shortage onto the rep. Returns what it moved, or null when there was
 * nothing short. Posted once per settlement (an entry is unique by its source).
 */
export async function postRepShortage(
  tx: Transaction,
  src: RepShortageSource,
): Promise<SettlementRepDebt | null> {
  const short = Object.entries(src.cashDifference)
    .filter(([, diff]) => diff < 0)
    .map(([currency, diff]) => ({ currency: currency as CurrencyCode, native: -diff }));
  if (short.length === 0) return null;

  // What the shift closes of that day already booked as a loss (the entries that debit 6200), per currency
  const booked = new Map<string, { native: number; base: number }>();
  if (src.shiftIds.length > 0) {
    const rows = await tx.execute<{ currency: string; native: string; base: string }>(sql`
      select l.currency, sum(-l.amount_minor)::text as native, sum(l.credit_minor - l.debit_minor)::text as base
      from journal_lines l
      join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where e.source_type = 'shift_close' and l.shift_id in (${uuidList(src.shiftIds)})
        and a.code ~ '^1110[0-9]{2}$'
        and exists (
          select 1 from journal_lines x join accounts xa on xa.tenant_id = x.tenant_id and xa.id = x.account_id
          where x.entry_id = e.id and xa.code = '6200' and x.debit_minor > 0)
      group by l.currency`);
    for (const r of rows) booked.set(r.currency, { native: Number(r.native), base: Number(r.base) });
  }

  const lines: DraftLine[] = [];
  let reclassified = 0;
  let total = 0;
  for (const s of short) {
    const was = booked.get(s.currency);
    const fromLoss = was && was.native > 0 ? Math.min(s.native, was.native) : 0;
    const fromLossBase =
      !was || fromLoss === 0
        ? 0
        : fromLoss === was.native
          ? was.base
          : Number(roundDiv(BigInt(was.base) * BigInt(fromLoss), BigInt(was.native)));
    const rest = s.native - fromLoss;
    let restBase = 0;
    if (rest > 0) {
      const foreign = s.currency !== src.baseCurrency;
      const rate = foreign ? await rateOf(tx, s.currency, src.baseCurrency) : null;
      restBase = toBase(rest, s.currency, src.baseCurrency, rate);
      lines.push({
        account: { cash: '1110', currency: s.currency },
        baseMinor: -restBase,
        currency: s.currency,
        amountMinor: -rest,
        rate,
        memo: `عجز عند التسوية ${src.settlementNumber}`,
      });
    }
    reclassified += fromLossBase;
    total += fromLossBase + restBase;
  }
  if (total === 0) return null;
  const memo = `ذمة على المندوب: عجز التسوية ${src.settlementNumber}`;
  lines.unshift({
    account: { code: STAFF_ACCOUNT },
    baseMinor: total,
    currency: src.baseCurrency,
    amountMinor: total,
    rate: null,
    party: { type: 'user', id: src.repUserId },
    memo,
  });
  if (reclassified > 0) {
    lines.push({
      account: { code: '6200' },
      baseMinor: -reclassified,
      currency: src.baseCurrency,
      amountMinor: -reclassified,
      rate: null,
      memo: 'نُقل عجز الصندوق من الخسارة إلى ذمة المندوب',
    });
  }
  const entryId = await postEntry(tx, {
    tenantId: src.tenantId,
    branchId: src.branchId,
    date: src.businessDate,
    sourceType: 'rep_settlement',
    sourceId: src.settlementId,
    sourceNumber: src.settlementNumber,
    memo,
    baseCurrency: src.baseCurrency,
    lines,
  });
  const [entry] = entryId
    ? await tx.execute<{ number: string }>(sql`select number from journal_entries where id = ${entryId}`)
    : [];
  return {
    shortage: Object.fromEntries(short.map((s) => [s.currency, s.native])),
    baseMinor: total,
    entryNumber: entry?.number ?? null,
  };
}

// ─── What a rep owes now ────────────────────────────────────────────────────

interface RepLookup {
  id: string;
  userId: string;
  name: string;
  branchId: string;
}

async function repOf(tx: Transaction, repId: string): Promise<RepLookup> {
  const [r] = await tx.execute<{ id: string; user_id: string; name: string; branch_id: string }>(sql`
    select r.id, r.user_id, u.full_name as name, r.branch_id
    from sales_reps r join users u on u.tenant_id = r.tenant_id and u.id = r.user_id
    where r.id = ${repId}`);
  if (!r) throw notFound();
  return { id: r.id, userId: r.user_id, name: r.name, branchId: r.branch_id };
}

/** What this user owes the shop: his lines in 1250, debit minus credit */
export async function repDebtBalance(tx: Transaction, userId: string): Promise<number> {
  const [row] = await tx.execute<{ balance: string }>(sql`
    select coalesce(sum(l.debit_minor - l.credit_minor), 0)::text as balance
    from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
    where a.code = ${STAFF_ACCOUNT} and l.party_type = 'user' and l.party_id = ${userId}`);
  return Number(row?.balance ?? 0);
}

async function guard(tx: Transaction, auth: AccessClaims, branchId?: string): Promise<void> {
  await requirePermission(tx, auth.userId, 'rep.settle', branchId);
  await assertRepsEnabled(tx);
}

async function debtOf(tx: Transaction, tenantId: string, rep: RepLookup): Promise<RepDebt> {
  const rows = await tx.execute<{
    id: string;
    number: string;
    date: string;
    source_type: string;
    amount: string;
    memo: string | null;
    forgiven: boolean;
  }>(sql`
    select e.id, e.number, e.entry_date::text as date, e.source_type, (l.debit_minor - l.credit_minor)::text as amount,
           coalesce(l.memo, e.memo) as memo,
           exists (select 1 from journal_lines x join accounts xa on xa.tenant_id = x.tenant_id and xa.id = x.account_id
                   where x.entry_id = e.id and xa.code = '6200' and x.debit_minor > 0) as forgiven
    from journal_lines l
    join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
    join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
    where a.code = ${STAFF_ACCOUNT} and l.party_type = 'user' and l.party_id = ${rep.userId}
    order by e.entry_date desc, e.year desc, e.seq desc`);
  const entries: RepDebtEntry[] = rows.map((r) => {
    const amount = Number(r.amount);
    const kind: RepDebtKind =
      r.source_type === 'rep_settlement' ? 'shortage' : r.forgiven ? 'forgiven' : 'payment';
    return { id: r.id, number: r.number, date: r.date, kind, amountMinor: amount, memo: r.memo };
  });
  return {
    repId: rep.id,
    repName: rep.name,
    baseCurrency: await baseCurrencyOf(tx, tenantId),
    balanceMinor: entries.reduce((sum, e) => sum + e.amountMinor, 0),
    entries,
  };
}

/** GET /v1/reps/{id}/debt */
export function getRepDebt(db: Database, auth: AccessClaims, repId: string): Promise<RepDebt> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    const rep = await repOf(tx, repId);
    await requirePermission(tx, auth.userId, 'rep.settle', rep.branchId);
    return debtOf(tx, auth.tenantId, rep);
  });
}

/** GET /v1/rep-debts: every rep of the user's branches who owes something */
export function listRepDebts(db: Database, auth: AccessClaims): Promise<RepDebtBalance[]> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    const scope = await permissionScope(tx, auth.userId, 'rep.settle');
    const rows = await tx.execute<{ id: string; name: string; branch_id: string; balance: string }>(sql`
      select r.id, u.full_name as name, r.branch_id,
             coalesce((select sum(l.debit_minor - l.credit_minor)
                       from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
                       where a.code = ${STAFF_ACCOUNT} and l.party_type = 'user' and l.party_id = r.user_id), 0)::text as balance
      from sales_reps r join users u on u.tenant_id = r.tenant_id and u.id = r.user_id
      order by u.full_name, r.id`);
    return rows
      .filter((r) => Number(r.balance) !== 0 && inScope(scope, r.branch_id))
      .map((r) => ({ repId: r.id, repName: r.name, balanceMinor: Number(r.balance) }));
  });
}

async function today(tx: Transaction, tenantId: string): Promise<string> {
  const [row] = await tx.execute<{ d: string }>(
    sql`select (now() at time zone t.timezone)::date::text as d from tenants t where t.id = ${tenantId}`,
  );
  return row!.d;
}

async function settleDebt(
  db: Database,
  auth: AccessClaims,
  repId: string,
  kind: 'payment' | 'forgiven',
  input: { amountMinor: number; date?: string | undefined },
  describe: { memo: string; reason: string | null },
  meta: RequestMeta,
): Promise<RepDebt> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    const rep = await repOf(tx, repId);
    await requirePermission(tx, auth.userId, 'rep.settle', rep.branchId);
    // Forgiving is a loss decision: the owner's own permission, the one that reaches any account
    if (kind === 'forgiven') await requirePermission(tx, auth.userId, 'accounting.post');
    // One at a time per rep, so two screens cannot both take the same balance
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('rep_debt'), hashtext(${rep.userId}))`);
    const balance = await repDebtBalance(tx, rep.userId);
    if (balance <= 0) throw conflict('لا ذمة على هذا المندوب.');
    if (input.amountMinor > balance) {
      throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
        amountMinor: 'المبلغ أكبر من ذمة المندوب',
      });
    }
    const base = await baseCurrencyOf(tx, auth.tenantId);
    const [made] = await tx.execute<{ id: string }>(sql`select uuid_generate_v7() as id`);
    const party = { type: 'user' as const, id: rep.userId };
    const owed: DraftLine = {
      account: { code: STAFF_ACCOUNT },
      baseMinor: -input.amountMinor,
      currency: base,
      amountMinor: -input.amountMinor,
      rate: null,
      party,
      memo: describe.memo,
    };
    const other: DraftLine =
      kind === 'payment'
        ? {
            account: { cash: '1120', currency: base },
            baseMinor: input.amountMinor,
            currency: base,
            amountMinor: input.amountMinor,
            rate: null,
          }
        : {
            account: { code: '6200' },
            baseMinor: input.amountMinor,
            currency: base,
            amountMinor: input.amountMinor,
            rate: null,
            memo: describe.memo,
          };
    const date = input.date ?? (await today(tx, auth.tenantId));
    await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId: rep.branchId,
      date,
      sourceType: 'rep_debt',
      sourceId: made!.id,
      sourceNumber: null,
      memo: describe.memo,
      baseCurrency: base,
      lines: [other, owed],
      createdBy: auth.userId,
    });
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: kind === 'payment' ? 'rep_debt.payment' : 'rep_debt.forgive',
        entity: 'sales_rep',
        entityId: rep.id,
        ...(describe.reason ? { reason: describe.reason } : {}),
        changes: { balanceMinor: [balance, balance - input.amountMinor] },
      },
      meta,
    );
    return debtOf(tx, auth.tenantId, rep);
  });
}

/** POST /v1/reps/{id}/debt/payments: the rep pays some of it back in cash, into the safe */
export function payRepDebt(
  db: Database,
  auth: AccessClaims,
  repId: string,
  input: RepDebtPaymentInput,
  meta: RequestMeta,
): Promise<RepDebt> {
  return settleDebt(
    db,
    auth,
    repId,
    'payment',
    input,
    { memo: `سداد ذمة مندوب${input.note ? `: ${input.note}` : ''}`, reason: input.note ?? null },
    meta,
  );
}

/** POST /v1/reps/{id}/debt/forgive: the owner lets some of it go; it becomes the shop's loss */
export function forgiveRepDebt(
  db: Database,
  auth: AccessClaims,
  repId: string,
  input: RepDebtForgiveInput,
  meta: RequestMeta,
): Promise<RepDebt> {
  return settleDebt(
    db,
    auth,
    repId,
    'forgiven',
    input,
    { memo: `إعفاء من ذمة مندوب: ${input.reason}`, reason: input.reason },
    meta,
  );
}
