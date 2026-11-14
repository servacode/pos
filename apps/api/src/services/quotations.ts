import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  addDays,
  effectiveQuotationStatus,
  priceQuotation,
  QUOTATION_DEFAULT_DAYS,
  QUOTATION_NEXT,
  type CurrencyCode,
  type Quotation,
  type QuotationData,
  type QuotationLine,
  type QuotationListItem,
  type QuotationStatus,
  type QuotationTotals,
  type quotationListQuery,
  type quotationStatusInput,
  type quotationUpdateInput,
} from '@serva/core';
import {
  branches,
  customers,
  quotations,
  taxRates,
  users,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import type { z } from 'zod';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import type { DeviceClaims } from '../auth/device-guard';
import { AppError } from '../errors';

/**
 * «عروض الأسعار» (03 › الجملة: عرض السعر): numbered per store and year, kept as offered, followed
 * draft → sent → accepted → converted (a waiting one past its date reads expired). It posts nothing
 * and touches no stock: «حوّل إلى فاتورة» only marks it, the sale is the till's ordinary sale.
 */

const notFound = () => new AppError(404, 'not_found', 'عرض السعر هذا غير موجود.');
const stale = () => new AppError(409, 'stale_version', 'غيّر شخص آخر عرض السعر هذا للتو. حدّث الصفحة.');
const invalid = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);

/** Who makes or changes a quotation: a signed-in user in the admin, or a till */
export interface QuotationActor {
  tenantId: string;
  userId: string | null;
  branchId: string | null;
}

export const adminActor = (auth: AccessClaims): QuotationActor => ({
  tenantId: auth.tenantId,
  userId: auth.userId,
  branchId: null,
});
export const deviceActor = (device: DeviceClaims): QuotationActor => ({
  tenantId: device.tenantId,
  userId: null,
  branchId: device.branchId,
});

async function today(tx: Transaction, tenantId: string): Promise<string> {
  const [row] = await tx.execute<{ day: string }>(
    sql`select (now() at time zone t.timezone)::date::text as day from tenants t where t.id = ${tenantId}`,
  );
  return row!.day;
}

type Row = typeof quotations.$inferSelect;

const itemOf = (r: Row, day: string): QuotationListItem => ({
  id: r.id,
  number: r.number,
  status: effectiveQuotationStatus(r.status as QuotationStatus, r.validUntil, day),
  customerName: r.customerName,
  issueDate: r.issueDate,
  validUntil: r.validUntil,
  currency: r.currency as CurrencyCode,
  totalMinor: r.totalMinor,
  version: r.version,
});

async function viewOf(tx: Transaction, r: Row, day: string): Promise<Quotation> {
  let branchName: string | null = null;
  if (r.branchId) {
    const [b] = await tx.select({ name: branches.name }).from(branches).where(eq(branches.id, r.branchId));
    branchName = b?.name ?? null;
  }
  return {
    ...itemOf(r, day),
    customerId: r.customerId,
    customerPhone: r.customerPhone,
    customerTaxNumber: r.customerTaxNumber,
    customerAddress: r.customerAddress,
    taxInclusive: r.taxInclusive,
    notes: r.notes,
    terms: r.terms,
    lines: r.lines as QuotationLine[],
    invoiceDiscount: (r.invoiceDiscount ?? null) as QuotationData['invoiceDiscount'],
    totals: r.totals as QuotationTotals,
    convertedAt: r.convertedAt?.toISOString() ?? null,
    createdByName: r.createdByName,
    branchName,
    createdAt: r.createdAt.toISOString(),
  };
}

/** The customer's own details fill what the form left empty; a customer that is not the store's is refused */
async function customerFields(tx: Transaction, input: QuotationData) {
  const typed = {
    customerName: input.customerName || null,
    customerPhone: input.customerPhone || null,
    customerTaxNumber: input.customerTaxNumber || null,
    customerAddress: input.customerAddress || null,
  };
  if (!input.customerId) return { customerId: null, ...typed };
  const [c] = await tx.select().from(customers).where(eq(customers.id, input.customerId));
  if (!c) throw invalid({ customerId: 'هذا الزبون غير موجود' });
  return {
    customerId: c.id,
    customerName: typed.customerName ?? c.name,
    customerPhone: typed.customerPhone ?? c.phone,
    customerTaxNumber: typed.customerTaxNumber ?? c.taxNumber,
    customerAddress: typed.customerAddress ?? c.address,
  };
}

/** A line's tax rate row is the authority for its percentage; an unknown or archived rate is refused */
async function withRates(tx: Transaction, lines: QuotationData['lines']): Promise<QuotationData['lines']> {
  const ids = [...new Set(lines.map((l) => l.taxRateId).filter((v): v is string => v !== null))];
  if (ids.length === 0) return lines.map((l) => ({ ...l, taxRateBp: 0 }));
  const rows = await tx.select().from(taxRates).where(inArray(taxRates.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return lines.map((l, i) => {
    if (l.taxRateId === null) return { ...l, taxRateBp: 0 };
    const rate = byId.get(l.taxRateId);
    if (!rate) throw invalid({ [`lines.${i}.taxRateId`]: 'هذه الضريبة غير موجودة' });
    return { ...l, taxRateBp: rate.rateBp };
  });
}

async function priced(tx: Transaction, input: QuotationData, taxInclusive: boolean) {
  const lines = await withRates(tx, input.lines);
  try {
    return priceQuotation(lines, input.invoiceDiscount ?? null, taxInclusive);
  } catch (error) {
    if (error instanceof RangeError) throw invalid({ lines: 'الخصم أكبر من مبلغ السطر' });
    throw error;
  }
}

async function settingsOf(tx: Transaction, tenantId: string) {
  const [s] = await tx.execute<{ base: string; inclusive: boolean }>(
    sql`select base_currency as base, tax_inclusive as inclusive from tenant_settings where tenant_id = ${tenantId}`,
  );
  return { currency: s?.base ?? 'SYP', taxInclusive: s?.inclusive ?? true };
}

function checkDates(validUntil: string, day: string) {
  if (validUntil < day) throw invalid({ validUntil: 'آخر يوم للعرض قبل اليوم' });
}

export function createQuotation(
  db: Database,
  actor: QuotationActor,
  input: QuotationData,
  defaultStatus: 'draft' | 'sent',
): Promise<Quotation> {
  return withTenant(db, actor.tenantId, async (tx) => {
    if (actor.userId) await requirePermission(tx, actor.userId, 'customers.manage');
    const day = await today(tx, actor.tenantId);
    const validUntil = input.validUntil ?? addDays(day, QUOTATION_DEFAULT_DAYS);
    checkDates(validUntil, day);
    const settings = await settingsOf(tx, actor.tenantId);
    const result = await priced(tx, input, settings.taxInclusive);
    const customer = await customerFields(tx, input);
    let createdByName: string | null = null;
    if (actor.userId) {
      const [u] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, actor.userId));
      createdByName = u?.name ?? null;
    }
    const year = Number(day.slice(0, 4));
    // Numbers follow each other within a store and year; the lock keeps two screens off the same one
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('quotations'), hashtext(${actor.tenantId}))`);
    const [last] = await tx.execute<{ seq: number | null }>(
      sql`select max(seq) as seq from quotations where tenant_id = ${actor.tenantId} and year = ${year}`,
    );
    const seq = (last?.seq ?? 0) + 1;
    const [made] = await tx
      .insert(quotations)
      .values({
        tenantId: actor.tenantId,
        year,
        seq,
        number: `QUO-${year}-${String(seq).padStart(6, '0')}`,
        status: input.status ?? defaultStatus,
        branchId: actor.branchId,
        ...customer,
        currency: settings.currency,
        taxInclusive: settings.taxInclusive,
        issueDate: day,
        validUntil,
        notes: input.notes || null,
        terms: input.terms || null,
        lines: result.lines,
        invoiceDiscount: input.invoiceDiscount ?? null,
        totals: result.totals,
        totalMinor: result.totals.totalMinor,
        createdBy: actor.userId,
        createdByName,
      })
      .returning();
    return viewOf(tx, made!, day);
  });
}

export function updateQuotation(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: z.output<typeof quotationUpdateInput>,
): Promise<Quotation> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.manage');
    const [current] = await tx.select().from(quotations).where(eq(quotations.id, id)).for('update');
    if (!current) throw notFound();
    if (current.version !== input.version) throw stale();
    if (current.status === 'converted') {
      throw new AppError(409, 'conflict', 'هذا العرض حُوّل إلى فاتورة، فلا يُعدَّل. أعد فتحه أولاً.');
    }
    const day = await today(tx, auth.tenantId);
    const validUntil = input.validUntil ?? current.validUntil;
    checkDates(validUntil, day);
    const result = await priced(tx, input, current.taxInclusive);
    const customer = await customerFields(tx, input);
    const [row] = await tx
      .update(quotations)
      .set({
        // A lapsed offer given a new date is open again
        status: current.status === 'expired' ? 'sent' : current.status,
        ...customer,
        validUntil,
        notes: input.notes || null,
        terms: input.terms || null,
        lines: result.lines,
        invoiceDiscount: input.invoiceDiscount ?? null,
        totals: result.totals,
        totalMinor: result.totals.totalMinor,
        updatedAt: new Date(),
      })
      .where(eq(quotations.id, id))
      .returning();
    return viewOf(tx, row!, day);
  });
}

async function moveStatus(
  tx: Transaction,
  id: string,
  to: QuotationStatus,
  version: number,
): Promise<Quotation> {
  const [current] = await tx.select().from(quotations).where(eq(quotations.id, id)).for('update');
  if (!current) throw notFound();
  if (current.version !== version) throw stale();
  const day = await today(tx, current.tenantId);
  const from = current.status as QuotationStatus;
  if (!QUOTATION_NEXT[from].includes(to)) {
    throw invalid({ status: 'لا يمكن نقل العرض إلى هذه الحالة من حالته الآن' });
  }
  if (to === 'converted' && effectiveQuotationStatus(from, current.validUntil, day) === 'expired') {
    throw invalid({ status: 'انتهت صلاحية هذا العرض. جدّد التاريخ أولاً' });
  }
  const [row] = await tx
    .update(quotations)
    .set({
      status: to,
      convertedAt: to === 'converted' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(quotations.id, id))
    .returning();
  return viewOf(tx, row!, day);
}

export function setQuotationStatus(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: z.output<typeof quotationStatusInput>,
): Promise<Quotation> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.manage');
    return moveStatus(tx, id, input.status, input.version);
  });
}

/** The till opened it in its cart: it is now «حُوّل إلى فاتورة» */
export function convertQuotation(
  db: Database,
  tenantId: string,
  id: string,
  version: number,
): Promise<Quotation> {
  return withTenant(db, tenantId, (tx) => moveStatus(tx, id, 'converted', version));
}

function filterOf(query: z.output<typeof quotationListQuery>, day: string): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  const waiting = inArray(quotations.status, ['draft', 'sent', 'accepted']);
  const live = sql`${quotations.validUntil} >= ${day}`;
  if (query.status === 'open') parts.push(and(waiting, live));
  else if (query.status === 'expired') {
    parts.push(or(eq(quotations.status, 'expired'), and(waiting, sql`${quotations.validUntil} < ${day}`)));
  } else if (query.status === 'converted') parts.push(eq(quotations.status, 'converted'));
  else if (query.status !== 'all') parts.push(and(eq(quotations.status, query.status), live));
  if (query.q) {
    const like = `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    parts.push(or(ilike(quotations.number, like), ilike(quotations.customerName, like)));
  }
  return and(...parts);
}

export function listQuotations(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof quotationListQuery>,
): Promise<{ items: QuotationListItem[] }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.manage');
    const day = await today(tx, auth.tenantId);
    const rows = await tx
      .select()
      .from(quotations)
      .where(filterOf(query, day))
      .orderBy(desc(quotations.createdAt), desc(quotations.id))
      .limit(200);
    return { items: rows.map((r) => itemOf(r, day)) };
  });
}

export function getQuotation(db: Database, auth: AccessClaims, id: string): Promise<Quotation> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.manage');
    const [row] = await tx.select().from(quotations).where(eq(quotations.id, id));
    if (!row) throw notFound();
    return viewOf(tx, row, await today(tx, auth.tenantId));
  });
}

/** What a till may open: the quotations still waiting for an answer, newest first */
export function openQuotationsForTill(db: Database, device: DeviceClaims): Promise<{ items: Quotation[] }> {
  return withTenant(db, device.tenantId, async (tx) => {
    const day = await today(tx, device.tenantId);
    const rows = await tx
      .select()
      .from(quotations)
      .where(filterOf({ status: 'open' }, day))
      .orderBy(desc(quotations.createdAt), desc(quotations.id))
      .limit(100);
    return { items: await Promise.all(rows.map((r) => viewOf(tx, r, day))) };
  });
}

export function getQuotationForTill(db: Database, device: DeviceClaims, id: string): Promise<Quotation> {
  return withTenant(db, device.tenantId, async (tx) => {
    const [row] = await tx.select().from(quotations).where(eq(quotations.id, id));
    if (!row) throw notFound();
    return viewOf(tx, row, await today(tx, device.tenantId));
  });
}
