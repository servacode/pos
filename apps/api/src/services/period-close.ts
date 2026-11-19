import { sql } from 'drizzle-orm';
import {
  businessDateOf,
  type PeriodCloseInput,
  type PeriodCloseState,
  type PeriodReopenInput,
} from '@serva/core';
import { periodLocks, withTenant, type Database, type Transaction } from '@serva/db';
import { createUuidV7 } from '@serva/sync';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { checkIntegrity } from './integrity';

/**
 * «إقفال الفترة» (round 37, decision 17; the design is D:\serva-work\period-close-design.md).
 *
 * The store has one closing date: the `locked_through` of the latest row of period_locks (none: nothing is
 * closed). Two rules read it:
 *  1. a document a person writes on the dashboard, dated on or before it, is refused (assertDateOpen);
 *  2. postEntry never refuses: an entry whose day is closed is posted on the first open day, flagged
 *     posted_to_open_period (postingDateFor), so a document that reached the server late is never lost.
 * Nothing posted is ever changed: a close or a reopen only moves the date. All of it is additive: a store that
 * never closes a period has no row here, and every entry posts exactly as before.
 */

const newId = createUuidV7();
const conflict = (message: string, fields?: Record<string, string>) =>
  new AppError(409, 'conflict', message, fields);

/** The store's closing date, or null */
export async function lockedThrough(tx: Transaction, tenantId: string): Promise<string | null> {
  const [row] = await tx.execute<{ through: string | null }>(sql`
    select locked_through::text as through from period_locks
    where tenant_id = ${tenantId} order by created_at desc, id desc limit 1`);
  return row?.through ?? null;
}

/** The day after an ISO date */
export function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The day before an ISO date */
function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The ledger's date for an event on `entryDate`: the same day when it is open, else the first open day.
 * `moved` marks the entry (posted_to_open_period).
 */
export async function postingDateFor(
  tx: Transaction,
  tenantId: string,
  entryDate: string,
): Promise<{ postingDate: string; moved: boolean }> {
  const through = await lockedThrough(tx, tenantId);
  if (through && entryDate <= through) return { postingDate: dayAfter(through), moved: true };
  return { postingDate: entryDate, moved: false };
}

/** Throws the plain-Arabic refusal when `date` is in the closed period */
export async function assertDateOpen(
  tx: Transaction,
  tenantId: string,
  date: string,
  field = 'date',
): Promise<void> {
  const through = await lockedThrough(tx, tenantId);
  if (through && date <= through) {
    const message = `هذه الفترة مقفلة حتى ${through}. اطلب من المالك فتحها، أو سجّل المستند بتاريخ بعد الإقفال.`;
    throw new AppError(409, 'period_closed', message, { [field]: message });
  }
}

/** The same check for a route, before it calls a service that opens its own transaction */
export function assertDatesOpen(
  db: Database,
  auth: AccessClaims,
  dates: readonly (string | undefined)[],
  field = 'date',
): Promise<void> {
  const wanted = dates.filter((d): d is string => !!d);
  if (wanted.length === 0) return Promise.resolve();
  return withTenant(db, auth.tenantId, async (tx) => {
    for (const d of wanted) await assertDateOpen(tx, auth.tenantId, d, field);
  });
}

async function today(tx: Transaction, tenantId: string, now: Date): Promise<string> {
  const [zone] = await tx.execute<{ timezone: string }>(
    sql`select timezone from tenants where id = ${tenantId}`,
  );
  return businessDateOf(now, zone?.timezone ?? 'Asia/Damascus');
}

async function state(
  tx: Transaction,
  auth: AccessClaims,
  now: Date,
  checks: PeriodCloseState['checks'],
): Promise<PeriodCloseState> {
  const through = await lockedThrough(tx, auth.tenantId);
  const history = await tx.execute<{
    id: string;
    kind: 'close' | 'reopen';
    locked_through: string | null;
    previous_through: string | null;
    reason: string | null;
    by: string | null;
    at: string;
  }>(sql`
    select p.id, p.kind, p.locked_through::text, p.previous_through::text, p.reason, u.full_name as by,
           to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
    from period_locks p left join users u on u.tenant_id = p.tenant_id and u.id = p.created_by
    where p.tenant_id = ${auth.tenantId} order by p.created_at desc, p.id desc limit 50`);
  const late = await tx.execute<{
    id: string;
    number: string;
    entry_date: string;
    posting_date: string;
    source_type: string;
    source_number: string | null;
    memo: string;
    total: string;
  }>(sql`
    select id, number, entry_date::text, posting_date::text, source_type, source_number, memo, total_minor::text as total
    from journal_entries where tenant_id = ${auth.tenantId} and posted_to_open_period
    order by posting_date desc, year desc, seq desc limit 200`);
  const [sum] = await tx.execute<{ total: string }>(sql`
    select coalesce(sum(total_minor), 0)::text as total from journal_entries
    where tenant_id = ${auth.tenantId} and posted_to_open_period`);
  const [settings] = await tx.execute<{ base: string }>(
    sql`select base_currency as base from tenant_settings`,
  );
  return {
    lockedThrough: through,
    firstOpenDay: through ? dayAfter(through) : null,
    latestCloseDate: dayBefore(await today(tx, auth.tenantId, now)),
    history: history.map((h) => ({
      id: h.id,
      kind: h.kind,
      lockedThrough: h.locked_through,
      previousThrough: h.previous_through,
      reason: h.reason,
      by: h.by ?? '',
      at: h.at,
    })),
    late: late.map((e) => ({
      entryId: e.id,
      number: e.number,
      entryDate: e.entry_date,
      postingDate: e.posting_date,
      sourceType: e.source_type,
      sourceNumber: e.source_number,
      memo: e.memo,
      totalMinor: Number(e.total),
    })),
    lateTotalMinor: Number(sum?.total ?? 0),
    baseCurrency: settings?.base ?? 'SYP',
    checks,
  };
}

/** GET /v1/period-close: the closing date, its history and what arrived late, with the checks a close would need */
export function periodCloseState(db: Database, auth: AccessClaims, now: Date): Promise<PeriodCloseState> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'accounting.view');
    const report = await checkIntegrity(tx, auth.tenantId);
    return state(
      tx,
      auth,
      now,
      report.checks.map((c) => ({ name: c.name, ok: c.ok, problems: c.problems.slice(0, 5) })),
    );
  });
}

export function closePeriod(
  db: Database,
  auth: AccessClaims,
  input: PeriodCloseInput,
  meta: RequestMeta,
  now: Date,
): Promise<PeriodCloseState> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'period.lock');
    const current = await lockedThrough(tx, auth.tenantId);
    const latest = dayBefore(await today(tx, auth.tenantId, now));
    if (input.through > latest) {
      const message = 'لا يُقفل اليوم ولا يوم لم يأتِ بعد. اختر تاريخاً قبل اليوم.';
      throw new AppError(400, 'validation_failed', message, { through: message });
    }
    if (current && input.through <= current) {
      const message = `الفترة مقفلة أصلاً حتى ${current}. اختر تاريخاً أحدث، أو افتح الفترة أولاً.`;
      throw conflict(message, { through: message });
    }
    // The books must agree with themselves before they are closed
    const report = await checkIntegrity(tx, auth.tenantId);
    const checks = report.checks.map((c) => ({ name: c.name, ok: c.ok, problems: c.problems.slice(0, 5) }));
    if (!report.ok) {
      const first = report.checks.find((c) => !c.ok);
      throw conflict(`لا يمكن الإقفال قبل معالجة فحص السلامة: ${first?.problems[0] ?? first?.name ?? ''}`, {
        through: 'فحص السلامة غير سليم',
      });
    }
    await tx.insert(periodLocks).values({
      tenantId: auth.tenantId,
      id: newId(),
      kind: 'close',
      lockedThrough: input.through,
      previousThrough: current,
      reason: input.note?.trim() || null,
      createdBy: auth.userId,
    });
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'period.close',
        entity: 'period',
        entityId: auth.tenantId,
        changes: { lockedThrough: [current, input.through] },
        ...(input.note ? { reason: input.note } : {}),
      },
      meta,
    );
    return state(tx, auth, now, checks);
  });
}

export function reopenPeriod(
  db: Database,
  auth: AccessClaims,
  input: PeriodReopenInput,
  meta: RequestMeta,
  now: Date,
): Promise<PeriodCloseState> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'period.unlock');
    const current = await lockedThrough(tx, auth.tenantId);
    if (!current) throw conflict('لا توجد فترة مقفلة لتفتحها.');
    if (input.through !== null && input.through >= current) {
      const message = `ارجع بالتاريخ إلى ما قبل ${current}، أو افتح الفترة كلها.`;
      throw new AppError(400, 'validation_failed', message, { through: message });
    }
    const reason = input.reason.trim();
    await tx.insert(periodLocks).values({
      tenantId: auth.tenantId,
      id: newId(),
      kind: 'reopen',
      lockedThrough: input.through,
      previousThrough: current,
      reason,
      createdBy: auth.userId,
    });
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'period.reopen',
        entity: 'period',
        entityId: auth.tenantId,
        changes: { lockedThrough: [current, input.through] },
        reason,
      },
      meta,
    );
    return state(tx, auth, now, []);
  });
}
