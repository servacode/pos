import { sql } from 'drizzle-orm';
import {
  allocatePayment,
  buildSchedule,
  businessDateOf,
  daysLate,
  instalmentSettingsOf,
  instalmentState,
  plusDays,
  type CollectInput,
  type CurrencyCode,
  type CustomerInstalments,
  type InstalmentPlanInput,
  type InstalmentSettings,
  type InstalmentSettingsInput,
  type InstalmentSummary,
  type PlanDetail,
  type PlanInstalment,
  type PlanListItem,
  type PlanNote,
  type PlanPayment,
  type PlanStatus,
  type ReceiptAllocation,
  type SalePayload,
  type WorklistBucket,
  type WorklistRow,
} from '@serva/core';
import { withTenant, type Database, type Transaction } from '@serva/db';
import type { SyncFlag } from '@serva/sync';
import { createUuidV7 } from '@serva/sync';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import type { DeviceClaims } from '../auth/device-guard';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { receiveCustomerPayment } from './customer-money';

/**
 * Instalments (packages/core › contracts/installments.ts, installments.ts). A plan is a schedule
 * laid over the customer's receivable: the sale that finances goods and the receipt that pays toward
 * them post exactly as they do without a plan (posting.ts is not touched), and this file keeps the
 * projection: the plan and its instalments from the sale, what each receipt settled from the receipt.
 * A printed sale or a taken payment is never refused here: what does not add up is kept out of the
 * plan and flagged for the owner.
 */

const newId = createUuidV7();
const notFound = () => new AppError(404, 'not_found', 'هذه الخطة غير موجودة.');

type Ctx = { tenantId: string; branchId: string; userId: string | null };

interface Day {
  today: string;
  timezone: string;
  base: CurrencyCode;
  storeName: string;
  settings: InstalmentSettings;
}

async function dayOf(tx: Transaction, now: Date): Promise<Day> {
  const [row] = await tx.execute<{
    timezone: string;
    cutoff: string;
    base: string;
    name: string;
    installments: Partial<InstalmentSettings> | null;
  }>(sql`
    select t.timezone, s.business_day_cutoff as cutoff, s.base_currency as base, t.name, s.installments
    from tenant_settings s join tenants t on t.id = s.tenant_id`);
  if (!row) throw notFound();
  return {
    today: businessDateOf(now, row.timezone, row.cutoff),
    timezone: row.timezone,
    base: row.base as CurrencyCode,
    storeName: row.name,
    settings: instalmentSettingsOf(row.installments),
  };
}

// ─── From the documents (inside the sync savepoint) ─────────────────────────────

/**
 * A sale's plan: checked against the sale's own credit payment and against the server's schedule.
 * What does not add up leaves the plan out (the sale stands, flagged); what differs only in how the
 * instalments were rounded keeps the printed schedule, flagged.
 */
export async function recordPlanFromSale(
  tx: Transaction,
  ctx: Ctx,
  doc: { id: string; number: string; businessDate: string },
  sale: SalePayload,
): Promise<SyncFlag[]> {
  const plan = sale.installmentPlan;
  if (!plan) return [];
  const credit = sale.payments
    .filter((p) => p.method === 'credit')
    .reduce((s, p) => s + p.baseAmountMinor, 0);
  const schedule = [...plan.schedule].sort((a, b) => a.no - b.no);
  const sum = schedule.reduce((s, i) => s + i.amountMinor, 0);
  const ordered = schedule.every(
    (i, idx) => i.no === idx + 1 && (idx === 0 || i.dueDate > schedule[idx - 1]!.dueDate),
  );
  const valid =
    sale.customerId !== null &&
    plan.financedMinor === credit &&
    plan.financedMinor === plan.principalMinor + plan.markupMinor &&
    sum === plan.financedMinor &&
    schedule.length === plan.count &&
    ordered;
  if (!valid) return ['installment_plan_invalid'];

  const flags: SyncFlag[] = [];
  const [settingsRow] = await tx.execute<{ installments: Partial<InstalmentSettings> | null }>(
    sql`select installments from tenant_settings`,
  );
  const settings = instalmentSettingsOf(settingsRow?.installments);
  try {
    const mine = buildSchedule({
      totalMinor: plan.principalMinor + plan.downPaymentMinor,
      downPaymentMinor: plan.downPaymentMinor,
      count: plan.count,
      frequency: plan.frequency,
      firstDueDate: plan.firstDueDate,
      customDates: plan.frequency === 'custom' ? schedule.map((i) => i.dueDate) : undefined,
      markupMinor: plan.markupMinor,
      roundingStepMinor: settings.roundingStepMinor,
    });
    const same = mine.instalments.every(
      (i, idx) => i.dueDate === schedule[idx]!.dueDate && i.amountMinor === schedule[idx]!.amountMinor,
    );
    if (!same) flags.push('schedule_mismatch');
  } catch {
    flags.push('schedule_mismatch');
  }

  const [made] = await tx.execute<{ id: string }>(sql`
    insert into installment_plans
      (id, tenant_id, number, branch_id, customer_id, sale_id, source, currency, total_minor, down_payment_minor,
       principal_minor, markup_minor, financed_minor, markup_bp, installments_count, frequency, first_due_date,
       borrower, guarantor, notes_mode, created_by)
    values
      (${plan.id}, ${ctx.tenantId}, ${doc.number}, ${ctx.branchId}, ${sale.customerId}, ${doc.id}, 'sale',
       ${sale.currency}, ${plan.principalMinor + plan.downPaymentMinor}, ${plan.downPaymentMinor},
       ${plan.principalMinor}, ${plan.markupMinor}, ${plan.financedMinor}, ${plan.markupBp}, ${plan.count},
       ${plan.frequency}, ${plan.firstDueDate}, ${plan.borrower ? JSON.stringify(plan.borrower) : null}::jsonb,
       ${plan.guarantor ? JSON.stringify(plan.guarantor) : null}::jsonb, ${plan.notesMode ?? 'none'},
       ${sale.cashierId})
    on conflict do nothing
    returning id`);
  if (!made) return flags;
  for (const i of schedule) {
    await tx.execute(sql`
      insert into installments (tenant_id, plan_id, no, due_date, amount_minor)
      values (${ctx.tenantId}, ${plan.id}, ${i.no}, ${i.dueDate}, ${i.amountMinor})`);
  }
  await writeNotes(tx, ctx.tenantId, plan, schedule, sale.customerId!, doc);
  return flags;
}

/** The promissory notes of a plan (none, one per instalment, or one for all of it); numbers follow the sale's so a till can print them offline */
async function writeNotes(
  tx: Transaction,
  tenantId: string,
  plan: InstalmentPlanInput,
  schedule: { no: number; dueDate: string; amountMinor: number }[],
  customerId: string,
  doc: { number: string; businessDate: string },
): Promise<void> {
  const mode = plan.notesMode ?? 'none';
  if (mode === 'each') {
    for (const i of schedule) {
      await tx.execute(sql`
        insert into promissory_notes (tenant_id, number, plan_id, no, customer_id, amount_minor, issue_date, due_date)
        values (${tenantId}, ${`${doc.number}-${String(i.no).padStart(2, '0')}`}, ${plan.id}, ${i.no}, ${customerId},
                ${i.amountMinor}, ${doc.businessDate}, ${i.dueDate})
        on conflict do nothing`);
    }
  } else if (mode === 'single') {
    const last = schedule[schedule.length - 1]!;
    await tx.execute(sql`
      insert into promissory_notes (tenant_id, number, plan_id, no, customer_id, amount_minor, issue_date, due_date)
      values (${tenantId}, ${`${doc.number}-ALL`}, ${plan.id}, null, ${customerId}, ${plan.financedMinor},
              ${doc.businessDate}, ${last.dueDate})
      on conflict do nothing`);
  }
}

/**
 * What a payment settled of the instalments it names. Each is capped at what was left of it (two
 * tills taking the same instalment: both receipts are real money, the second one's excess stays the
 * customer's credit and is flagged), written once per receipt and instalment.
 */
export async function applyAllocations(
  tx: Transaction,
  ctx: { tenantId: string },
  receipt: { id: string; businessDate: string; customerId: string },
  allocations: readonly ReceiptAllocation[],
): Promise<SyncFlag[]> {
  const flags = new Set<SyncFlag>();
  const touched = new Set<string>();
  for (const a of allocations) {
    const [row] = await tx.execute<{ amount: string; paid: string; status: string; customer_id: string }>(sql`
      select i.amount_minor::text as amount, i.paid_minor::text as paid, i.status, p.customer_id
      from installments i join installment_plans p on p.tenant_id = i.tenant_id and p.id = i.plan_id
      where i.plan_id = ${a.planId} and i.no = ${a.no} for update of i`);
    if (!row || row.customer_id !== receipt.customerId || row.status === 'cancelled') {
      flags.add('installment_plan_invalid');
      continue;
    }
    const room = Number(row.amount) - Number(row.paid);
    const take = Math.min(room, a.amountMinor);
    if (take < a.amountMinor) flags.add('installment_overpaid');
    if (take <= 0) continue;
    const [written] = await tx.execute<{ id: string }>(sql`
      insert into installment_payments (tenant_id, plan_id, no, receipt_id, amount_minor, pay_date)
      values (${ctx.tenantId}, ${a.planId}, ${a.no}, ${receipt.id}, ${take}, ${receipt.businessDate})
      on conflict do nothing returning id`);
    if (!written) continue;
    await tx.execute(sql`
      update installments
      set paid_minor = paid_minor + ${take},
          status = case when paid_minor + ${take} >= amount_minor then 'paid' else status end,
          paid_at = case when paid_minor + ${take} >= amount_minor then now() else paid_at end
      where plan_id = ${a.planId} and no = ${a.no}`);
    touched.add(a.planId);
  }
  for (const planId of touched) await closeIfPaid(tx, planId, receipt.businessDate);
  return [...flags];
}

/** Every instalment paid: the plan is completed and its notes are paid; an instalment paid in full marks its own note */
async function closeIfPaid(tx: Transaction, planId: string, day: string): Promise<void> {
  await tx.execute(sql`
    update promissory_notes n set status = 'paid', status_date = ${day}
    where n.plan_id = ${planId} and n.status = 'issued' and n.no is not null
      and exists (select 1 from installments i where i.plan_id = n.plan_id and i.no = n.no and i.status = 'paid')`);
  const [open] = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from installments where plan_id = ${planId} and status = 'open'`);
  if (open && open.n === 0) {
    await tx.execute(sql`
      update installment_plans set status = 'completed', closed_at = now()
      where id = ${planId} and status = 'active'`);
    await tx.execute(sql`
      update promissory_notes set status = 'paid', status_date = ${day}
      where plan_id = ${planId} and status = 'issued'`);
  }
}

// ─── Views ──────────────────────────────────────────────────────────────────────

type PlanRow = {
  id: string;
  number: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  sale_id: string | null;
  sale_number: string | null;
  status: PlanStatus;
  financed_minor: string;
  principal_minor: string;
  down_payment_minor: string;
  markup_minor: string;
  markup_bp: number;
  installments_count: number;
  frequency: PlanDetail['frequency'];
  guarantor: PlanDetail['guarantor'];
  borrower: PlanDetail['borrower'];
  close_reason: string | null;
  created_at: string;
};
type InstRow = {
  plan_id: string;
  no: number;
  due_date: string;
  amount: string;
  paid: string;
  status: string;
};

const planSelect = sql`
  select p.id, p.number, p.customer_id, c.name as customer_name, c.phone as customer_phone, p.sale_id,
         (select number from invoices v where v.id = p.sale_id) as sale_number, p.status,
         p.financed_minor::text, p.principal_minor::text, p.down_payment_minor::text, p.markup_minor::text,
         p.markup_bp, p.installments_count, p.frequency, p.guarantor, p.borrower, p.close_reason,
         p.created_at::text
  from installment_plans p join customers c on c.tenant_id = p.tenant_id and c.id = p.customer_id`;

function instalmentsOf(rows: InstRow[], today: string): PlanInstalment[] {
  return rows
    .sort((a, b) => a.no - b.no)
    .map((r) => {
      const amountMinor = Number(r.amount);
      const paidMinor = Number(r.paid);
      return {
        no: r.no,
        dueDate: r.due_date,
        amountMinor,
        paidMinor,
        state:
          r.status === 'cancelled'
            ? ('cancelled' as const)
            : instalmentState({ dueDate: r.due_date, amountMinor, paidMinor }, today),
        daysLate: r.status === 'open' ? daysLate(r.due_date, today) : 0,
      };
    });
}

function listItem(p: PlanRow, rows: InstRow[], today: string): PlanListItem {
  const list = instalmentsOf(rows, today);
  const live = list.filter((i) => i.state !== 'cancelled');
  // The next one is the one due soonest, which is the lowest number unless a day was changed by hand
  const open = live
    .filter((i) => i.paidMinor < i.amountMinor)
    .sort((x, y) => x.dueDate.localeCompare(y.dueDate) || x.no - y.no);
  const late = open.filter((i) => i.state === 'late');
  return {
    id: p.id,
    number: p.number,
    customerId: p.customer_id,
    customerName: p.customer_name,
    status: p.status,
    financedMinor: Number(p.financed_minor),
    paidMinor: live.reduce((s, i) => s + i.paidMinor, 0),
    remainingMinor: open.reduce((s, i) => s + (i.amountMinor - i.paidMinor), 0),
    count: p.installments_count,
    createdAt: p.created_at,
    nextDueDate: open[0]?.dueDate ?? null,
    nextDueMinor: open[0] ? open[0].amountMinor - open[0].paidMinor : 0,
    lateMinor: late.reduce((s, i) => s + (i.amountMinor - i.paidMinor), 0),
    lateCount: late.length,
  };
}

async function instalmentRows(tx: Transaction, planIds: string[]): Promise<Map<string, InstRow[]>> {
  const map = new Map<string, InstRow[]>();
  if (planIds.length === 0) return map;
  const rows = await tx.execute<InstRow>(sql`
    select plan_id, no, due_date::text, amount_minor::text as amount, paid_minor::text as paid, status
    from installments where plan_id in (${sql.join(
      planIds.map((i) => sql`${i}::uuid`),
      sql`, `,
    )})`);
  for (const r of rows) map.set(r.plan_id, [...(map.get(r.plan_id) ?? []), r]);
  return map;
}

export function listPlans(
  db: Database,
  auth: AccessClaims,
  query: { status?: PlanStatus; q?: string; customerId?: string; overdue?: boolean },
  now: Date,
): Promise<{ items: PlanListItem[]; baseCurrency: CurrencyCode; today: string }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'installments.view');
    const day = await dayOf(tx, now);
    const q = query.q ? `%${query.q.replace(/[%_]/g, '')}%` : null;
    const plans = await tx.execute<PlanRow>(sql`
      ${planSelect}
      where (${query.status ?? null}::text is null or p.status = ${query.status ?? null})
        and (${q}::text is null or p.number ilike ${q} or c.name ilike ${q})
        and (${query.customerId ?? null}::uuid is null or p.customer_id = ${query.customerId ?? null}::uuid)
      order by p.created_at desc limit 300`);
    const rows = await instalmentRows(
      tx,
      plans.map((p) => p.id),
    );
    let items = plans.map((p) => listItem(p, rows.get(p.id) ?? [], day.today));
    if (query.overdue) items = items.filter((i) => i.lateCount > 0);
    return { items, baseCurrency: day.base, today: day.today };
  });
}

async function detail(tx: Transaction, id: string, day: Day): Promise<PlanDetail> {
  const [p] = await tx.execute<PlanRow>(sql`${planSelect} where p.id = ${id}`);
  if (!p) throw notFound();
  const rows = (await instalmentRows(tx, [p.id])).get(p.id) ?? [];
  const pays = await tx.execute<{ receipt_id: string; no: number; amount: string; pay_date: string }>(sql`
    select receipt_id, no, amount_minor::text as amount, pay_date::text from installment_payments
    where plan_id = ${p.id} order by created_at, no`);
  const numbers = pays.length
    ? await tx.execute<{ id: string; number: string }>(sql`
        select id, number from receipts
        where id in (${sql.join(
          [...new Set(pays.map((x) => x.receipt_id))].map((i) => sql`${i}::uuid`),
          sql`, `,
        )})`)
    : [];
  const byId = new Map(numbers.map((n) => [n.id, n.number]));
  const payments: PlanPayment[] = pays.map((x) => ({
    receiptNumber: byId.get(x.receipt_id) ?? null,
    date: x.pay_date,
    no: x.no,
    amountMinor: Number(x.amount),
  }));
  return {
    ...listItem(p, rows, day.today),
    saleNumber: p.sale_number,
    saleId: p.sale_id,
    customerPhone: p.customer_phone,
    principalMinor: Number(p.principal_minor),
    downPaymentMinor: Number(p.down_payment_minor),
    markupMinor: Number(p.markup_minor),
    markupBp: p.markup_bp,
    frequency: p.frequency,
    guarantor: p.guarantor,
    borrower: p.borrower,
    closeReason: p.close_reason,
    instalments: instalmentsOf(rows, day.today),
    payments,
    storeName: day.storeName,
    noteText: day.settings.noteText,
    notePlace: day.settings.notePlace,
    notes: (
      await tx.execute<{
        id: string;
        number: string;
        no: number | null;
        amount: string;
        issue_date: string;
        due_date: string;
        status: PlanNote['status'];
        status_date: string | null;
        printed_count: number;
      }>(sql`
        select id, number, no, amount_minor::text as amount, issue_date::text, due_date::text, status,
               status_date::text, printed_count
        from promissory_notes where plan_id = ${p.id} order by no nulls last, number`)
    ).map((n) => ({
      id: n.id,
      number: n.number,
      no: n.no,
      amountMinor: Number(n.amount),
      issueDate: n.issue_date,
      dueDate: n.due_date,
      status: n.status,
      statusDate: n.status_date,
      printedCount: n.printed_count,
    })),
  };
}

export function getPlan(db: Database, auth: AccessClaims, id: string, now: Date): Promise<PlanDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'installments.view');
    return detail(tx, id, await dayOf(tx, now));
  });
}

// ─── Worklist and home counts ───────────────────────────────────────────────────

export function worklist(
  db: Database,
  auth: AccessClaims,
  bucket: WorklistBucket,
  now: Date,
): Promise<{ items: WorklistRow[]; today: string; baseCurrency: CurrencyCode }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'installments.view');
    const day = await dayOf(tx, now);
    const range =
      bucket === 'remind'
        ? sql`i.due_date in (${day.today}::date, ${plusDays(day.today, day.settings.reminderBeforeDays)}::date, ${plusDays(day.today, -day.settings.reminderAfterDays)}::date)`
        : bucket === 'today'
          ? sql`i.due_date = ${day.today}::date`
          : bucket === 'week'
            ? sql`i.due_date between ${day.today}::date and ${plusDays(day.today, 7)}::date`
            : sql`i.due_date < ${day.today}::date`;
    const rows = await tx.execute<{
      plan_id: string;
      number: string;
      customer_id: string;
      name: string;
      phone: string | null;
      no: number;
      of: number;
      due_date: string;
      remaining: string;
      last_reminder: string | null;
    }>(sql`
      select i.plan_id, p.number, p.customer_id, c.name, c.phone, i.no, p.installments_count as of,
             i.due_date::text, (i.amount_minor - i.paid_minor)::text as remaining,
             (select max(r.sent_at)::text from installment_reminders r where r.plan_id = i.plan_id and r.no = i.no) as last_reminder
      from installments i
      join installment_plans p on p.tenant_id = i.tenant_id and p.id = i.plan_id
      join customers c on c.tenant_id = p.tenant_id and c.id = p.customer_id
      where i.status = 'open' and p.status in ('active', 'defaulted') and ${range}
      order by i.due_date, p.number, i.no limit 500`);
    return {
      items: rows.map((r) => ({
        planId: r.plan_id,
        planNumber: r.number,
        customerId: r.customer_id,
        customerName: r.name,
        phone: r.phone,
        no: r.no,
        of: r.of,
        dueDate: r.due_date,
        remainingMinor: Number(r.remaining),
        daysLate: daysLate(r.due_date, day.today),
        lastReminderAt: r.last_reminder,
      })),
      today: day.today,
      baseCurrency: day.base,
    };
  });
}

export function summary(db: Database, auth: AccessClaims, now: Date): Promise<InstalmentSummary> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'installments.view');
    const day = await dayOf(tx, now);
    const [r] = await tx.execute<{
      today_n: number;
      today_m: string;
      late_n: number;
      late_m: string;
      plans: number;
      owed: string;
    }>(sql`
      select count(*) filter (where i.due_date = ${day.today}::date)::int as today_n,
             coalesce(sum(i.amount_minor - i.paid_minor) filter (where i.due_date = ${day.today}::date), 0)::text as today_m,
             count(*) filter (where i.due_date < ${day.today}::date)::int as late_n,
             coalesce(sum(i.amount_minor - i.paid_minor) filter (where i.due_date < ${day.today}::date), 0)::text as late_m,
             count(distinct i.plan_id)::int as plans,
             coalesce(sum(i.amount_minor - i.paid_minor), 0)::text as owed
      from installments i join installment_plans p on p.tenant_id = i.tenant_id and p.id = i.plan_id
      where i.status = 'open' and p.status in ('active', 'defaulted')`);
    return {
      dueTodayCount: r?.today_n ?? 0,
      dueTodayMinor: Number(r?.today_m ?? 0),
      lateCount: r?.late_n ?? 0,
      lateMinor: Number(r?.late_m ?? 0),
      activePlans: r?.plans ?? 0,
      outstandingMinor: Number(r?.owed ?? 0),
    };
  });
}

/** What the till shows of a customer's open plans (online only) */
export function customerInstalments(
  db: Database,
  device: DeviceClaims,
  customerId: string,
  now: Date,
): Promise<CustomerInstalments> {
  return withTenant(db, device.tenantId, async (tx) => {
    const day = await dayOf(tx, now);
    const plans = await tx.execute<PlanRow>(sql`
      ${planSelect} where p.customer_id = ${customerId} and p.status in ('active', 'defaulted')
      order by p.created_at`);
    const rows = await instalmentRows(
      tx,
      plans.map((p) => p.id),
    );
    return {
      today: day.today,
      plans: plans.map((p) => {
        const item = listItem(p, rows.get(p.id) ?? [], day.today);
        return {
          id: p.id,
          number: p.number,
          financedMinor: item.financedMinor,
          remainingMinor: item.remainingMinor,
          instalments: instalmentsOf(rows.get(p.id) ?? [], day.today),
        };
      }),
    };
  });
}

// ─── Actions ────────────────────────────────────────────────────────────────────

/** A WhatsApp click: who and when, so nobody sends twice by mistake */
export function logReminder(
  db: Database,
  auth: AccessClaims,
  planId: string,
  no: number,
  kind: 'before' | 'due' | 'late',
): Promise<{ ok: true }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'installments.view');
    const [found] = await tx.execute<{ ok: number }>(
      sql`select 1 as ok from installments where plan_id = ${planId} and no = ${no}`,
    );
    if (!found) throw notFound();
    await tx.execute(sql`
      insert into installment_reminders (tenant_id, plan_id, no, kind, sent_by)
      values (${auth.tenantId}, ${planId}, ${no}, ${kind}, ${auth.userId})`);
    return { ok: true };
  });
}

/**
 * Takes a payment toward a plan from the admin: the customer's payment posts as it always does
 * (customer-money.ts), and the same transaction settles the oldest open instalments with it.
 */
export async function collectOnPlan(
  db: Database,
  auth: AccessClaims,
  planId: string,
  input: CollectInput,
  meta: RequestMeta,
  now: Date,
): Promise<PlanDetail> {
  const paymentId = newId();
  const customerId = await withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'installments.view');
    const [row] = await tx.execute<{ customer_id: string; status: string }>(
      sql`select customer_id, status from installment_plans where id = ${planId}`,
    );
    if (!row) throw notFound();
    if (row.status !== 'active' && row.status !== 'defaulted') {
      throw new AppError(409, 'conflict', 'هذه الخطة مغلقة، لا يُقبض عليها.');
    }
    return row.customer_id;
  });
  await receiveCustomerPayment(
    db,
    auth,
    customerId,
    {
      amountMinor: input.amountMinor,
      method: input.method ?? 'cash',
      reference: input.reference ?? null,
      note: input.note ?? null,
      date: input.date,
      id: paymentId,
      branchId: input.branchId ?? null,
    },
    meta,
    now,
    async (tx, result) => {
      const open = await tx.execute<{ no: number; due_date: string; amount: string; paid: string }>(sql`
        select no, due_date::text, amount_minor::text as amount, paid_minor::text as paid
        from installments where plan_id = ${planId} and status = 'open' for update`);
      const split = allocatePayment(
        open.map((o) => ({
          id: String(o.no),
          dueDate: o.due_date,
          amountMinor: Number(o.amount),
          paidMinor: Number(o.paid),
        })),
        input.amountMinor,
      );
      await applyAllocations(
        tx,
        { tenantId: auth.tenantId },
        { id: paymentId, businessDate: result.date, customerId },
        split.allocations.map((a) => ({ planId, no: Number(a.installmentId), amountMinor: a.amountMinor })),
      );
      await audit(
        tx,
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: 'installment.collect',
          entity: 'installment_plan',
          entityId: planId,
          data: { number: result.number, amountMinor: input.amountMinor },
        },
        meta,
      );
    },
  );
  return withTenant(db, auth.tenantId, async (tx) => detail(tx, planId, await dayOf(tx, now)));
}

/** Cancels the open instalments of a plan; what the customer paid stays on their account (a return or a refund goes through the usual tools) */
export function cancelPlan(
  db: Database,
  auth: AccessClaims,
  planId: string,
  reason: string,
  meta: RequestMeta,
  now: Date,
): Promise<PlanDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'installments.manage');
    const [plan] = await tx.execute<{ status: string }>(
      sql`select status from installment_plans where id = ${planId} for update`,
    );
    if (!plan) throw notFound();
    if (plan.status === 'cancelled' || plan.status === 'completed') {
      throw new AppError(409, 'conflict', 'هذه الخطة مغلقة أصلاً.');
    }
    await tx.execute(sql`
      update installments set status = 'cancelled' where plan_id = ${planId} and status = 'open'`);
    await tx.execute(sql`
      update installment_plans set status = 'cancelled', closed_at = now(), close_reason = ${reason}
      where id = ${planId}`);
    await tx.execute(sql`
      update promissory_notes set status = 'cancelled', status_date = ${(await dayOf(tx, now)).today}
      where plan_id = ${planId} and status = 'issued'`);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'installment.plan_cancel',
        entity: 'installment_plan',
        entityId: planId,
        data: { reason },
      },
      meta,
    );
    return detail(tx, planId, await dayOf(tx, now));
  });
}

/**
 * After a return of an instalment sale: the open instalments are cancelled from the last backwards
 * until what is open equals what the customer still owes on the plan; a return of all of it cancels
 * the plan. Reads the journal, writes only the plan tables.
 */
export async function reconcilePlanAfterReturn(
  tx: Transaction,
  saleId: string,
  returnedOnAccountMinor: number,
): Promise<void> {
  if (returnedOnAccountMinor <= 0) return;
  const [plan] = await tx.execute<{ id: string }>(
    sql`select id from installment_plans where sale_id = ${saleId} and status in ('active', 'defaulted') for update`,
  );
  if (!plan) return;
  const open = await tx.execute<{ no: number; left: string }>(sql`
    select no, (amount_minor - paid_minor)::text as left from installments
    where plan_id = ${plan.id} and status = 'open' order by no desc`);
  let remaining = returnedOnAccountMinor;
  for (const i of open) {
    if (remaining <= 0) break;
    const left = Number(i.left);
    if (left <= remaining) {
      await tx.execute(
        sql`update installments set status = 'cancelled' where plan_id = ${plan.id} and no = ${i.no}`,
      );
      remaining -= left;
    } else {
      await tx.execute(sql`
        update installments set amount_minor = amount_minor - ${remaining} where plan_id = ${plan.id} and no = ${i.no}`);
      remaining = 0;
    }
  }
  const [left] = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from installments where plan_id = ${plan.id} and status = 'open'`,
  );
  if (left && left.n === 0) {
    await tx.execute(sql`
      update installment_plans set status = 'cancelled', closed_at = now(), close_reason = 'مرتجع'
      where id = ${plan.id}`);
    await tx.execute(sql`
      update promissory_notes set status = 'cancelled' where plan_id = ${plan.id} and status = 'issued'`);
  }
}

// ─── Settings ───────────────────────────────────────────────────────────────────

export function getSettings(db: Database, auth: AccessClaims): Promise<InstalmentSettings> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'installments.view');
    const [row] = await tx.execute<{ installments: Partial<InstalmentSettings> | null }>(
      sql`select installments from tenant_settings`,
    );
    return instalmentSettingsOf(row?.installments);
  });
}

export function saveSettings(
  db: Database,
  auth: AccessClaims,
  input: InstalmentSettingsInput,
  meta: RequestMeta,
): Promise<InstalmentSettings> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    const settings = instalmentSettingsOf(input as Partial<InstalmentSettings>);
    await tx.execute(sql`update tenant_settings set installments = ${JSON.stringify(settings)}::jsonb`);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'store.installments_update',
        entity: 'tenant_settings',
        entityId: auth.tenantId,
        data: { enabled: settings.enabled },
      },
      meta,
    );
    return settings;
  });
}

/** A note's status: paid back to the customer, protested for non-payment, or cancelled; posts nothing */
export function actOnNote(
  db: Database,
  auth: AccessClaims,
  noteId: string,
  action: 'paid' | 'protested' | 'cancelled',
  meta: RequestMeta,
  now: Date,
): Promise<PlanDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'installments.manage');
    const day = await dayOf(tx, now);
    const [note] = await tx.execute<{ plan_id: string; status: string }>(
      sql`select plan_id, status from promissory_notes where id = ${noteId} for update`,
    );
    if (!note) throw new AppError(404, 'not_found', 'هذه الكمبيالة غير موجودة.');
    if (note.status === 'cancelled') throw new AppError(409, 'conflict', 'هذه الكمبيالة ملغاة.');
    await tx.execute(sql`
      update promissory_notes set status = ${action}, status_date = ${day.today}::date where id = ${noteId}`);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: `installment.note_${action}`,
        entity: 'promissory_note',
        entityId: noteId,
      },
      meta,
    );
    return detail(tx, note.plan_id, day);
  });
}

/** A printed sheet is counted, so a reprint shows */
export function notesPrinted(db: Database, auth: AccessClaims, planId: string): Promise<{ ok: true }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'installments.view');
    const [found] = await tx.execute<{ ok: number }>(
      sql`select 1 as ok from installment_plans where id = ${planId}`,
    );
    if (!found) throw notFound();
    await tx.execute(
      sql`update promissory_notes set printed_count = printed_count + 1 where plan_id = ${planId}`,
    );
    return { ok: true };
  });
}
