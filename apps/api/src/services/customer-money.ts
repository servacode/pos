import { sql } from 'drizzle-orm';
import {
  businessDateOf,
  CUSTOMER_PAYMENT_LABEL,
  type CurrencyCode,
  type CustomerMoneyResult,
  type CustomerOpeningDebtInput,
  type CustomerPaymentInput,
} from '@serva/core';
import { withTenant, type Database, type Transaction } from '@serva/db';
import { createUuidV7 } from '@serva/sync';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { postOpeningBalance } from './import/opening';
import { postEntry, type DraftLine } from './posting';
import { baseCurrency, documentLock, nextNumber } from './purchases';
import { assertDateOpen } from './period-close';

/**
 * Money a customer's account takes from the admin screen (the customer page and the statement):
 * a payment received (the receipt of 08 › سند قبض, here without a till or a shift) and an opening
 * debt (the opening balance the import posts). Both are balanced entries through postEntry; a
 * posted entry is never changed, the owner reverses a mistake from the journal.
 */

const newId = createUuidV7();

async function customerFor(tx: Transaction, id: string) {
  const [row] = await tx.execute<{ id: string; name: string; balance: string }>(sql`
    select c.id, c.name,
           coalesce((select sum(l.debit_minor - l.credit_minor)
                     from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
                     where a.code = '1200' and l.party_type = 'customer' and l.party_id = c.id), 0)::text as balance
    from customers c where c.id = ${id}`);
  if (!row) throw new AppError(404, 'not_found', 'هذا الزبون غير موجود.');
  return { id: row.id, name: row.name, balance: Number(row.balance) };
}

/** The store's business day (its timezone and day cutoff), not the UTC date: a payment at 01:30 is today's */
async function dayOf(tx: Transaction, now: Date, date?: string): Promise<string> {
  if (date) return date;
  const [row] = await tx.execute<{ timezone: string; cutoff: string }>(sql`
    select t.timezone, s.business_day_cutoff as cutoff
    from tenant_settings s join tenants t on t.id = s.tenant_id`);
  return row ? businessDateOf(now, row.timezone, row.cutoff) : now.toISOString().slice(0, 10);
}

/** A payment cannot be dated after the store's business day: it would sit in a day that has not happened */
async function refuseFuture(tx: Transaction, now: Date, date: string | undefined): Promise<void> {
  if (!date) return;
  const today = await dayOf(tx, now);
  if (date > today) {
    throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
      date: 'التاريخ بعد اليوم. اختر اليوم أو تاريخاً سابقاً.',
    });
  }
}

/** A payment from a customer, into the safe or the method's account, against what they owe. */
export async function receiveCustomerPayment(
  db: Database,
  auth: AccessClaims,
  customerId: string,
  input: CustomerPaymentInput,
  meta: RequestMeta,
  now: Date,
  /** Runs in the same transaction once the payment is posted (instalments: what it settles) */
  inside?: (tx: Transaction, result: CustomerMoneyResult) => Promise<void>,
): Promise<CustomerMoneyResult> {
  return withTenant(db, auth.tenantId, async (tx) => {
    // Round 36 (X1): a payment that names its branch needs the right for that branch and a branch of this store
    const branchId = input.branchId ?? null;
    await requirePermission(tx, auth.userId, 'receipt.create', branchId ?? undefined);
    if (branchId) {
      const [branch] = await tx.execute<{ id: string }>(sql`select id from branches where id = ${branchId}`);
      if (!branch) {
        throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
          branchId: 'الفرع غير موجود',
        });
      }
    }
    await refuseFuture(tx, now, input.date);
    const customer = await customerFor(tx, customerId);
    const currency: CurrencyCode = await baseCurrency(tx);
    const date = await dayOf(tx, now, input.date);
    const id = input.id ?? newId();
    // Two requests with the same id at once: the second waits here, then finds the first one's receipt
    if (input.id) await documentLock(tx, 'customer_payment', id);
    // The same id sent again (a lost answer): answer with the receipt already posted, burn no number
    if (input.id) {
      const [again] = await tx.execute<{ number: string | null; date: string; amount: string }>(sql`
        select e.source_number as number, e.entry_date::text as date,
               (select coalesce(sum(l.credit_minor), 0)::text from journal_lines l
                 join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
                 where l.tenant_id = e.tenant_id and l.entry_id = e.id and a.code = '1200') as amount
        from journal_entries e
        where e.source_type = 'manual' and e.source_id = ${id} and e.kind = 'manual'`);
      if (again?.number) {
        const now2 = await customerFor(tx, customerId);
        return {
          kind: 'payment',
          number: again.number,
          date: again.date,
          customerId: customer.id,
          customerName: customer.name,
          amountMinor: Number(again.amount) || input.amountMinor,
          method: input.method,
          reference: input.reference ?? null,
          note: input.note ?? null,
          balanceBeforeMinor: now2.balance + (Number(again.amount) || input.amountMinor),
          balanceAfterMinor: now2.balance,
          baseCurrency: currency,
          ...(branchId ? { branchId } : {}),
        };
      }
    }
    const memoTail = [input.reference, input.note].filter(Boolean).join(' — ');
    const number = await nextNumber(tx, auth.tenantId, 'RCA', date);
    const account: DraftLine['account'] =
      input.method === 'cash'
        ? { cash: '1120', currency }
        : { code: { transfer: '1130', wallet: '1150', card: '1140' }[input.method] };
    const money: DraftLine = {
      account,
      baseMinor: input.amountMinor,
      currency,
      amountMinor: input.amountMinor,
      rate: null,
      memo: [CUSTOMER_PAYMENT_LABEL[input.method], input.reference].filter(Boolean).join(' '),
    };
    const owed: DraftLine = {
      account: { code: '1200' },
      baseMinor: -input.amountMinor,
      currency,
      amountMinor: -input.amountMinor,
      rate: null,
      memo: customer.name,
      party: { type: 'customer', id: customer.id },
    };
    const posted = await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId,
      date,
      sourceType: 'manual',
      sourceId: id,
      sourceNumber: number,
      memo: `سند قبض ${number} من ${customer.name}${memoTail ? ` — ${memoTail}` : ''}`,
      baseCurrency: currency,
      lines: [money, owed],
      kind: 'manual',
      createdBy: auth.userId,
    });
    if (posted !== null) {
      await audit(
        tx,
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: 'customer.payment',
          entity: 'customer',
          entityId: customer.id,
          changes: { balanceMinor: [customer.balance, customer.balance - input.amountMinor] },
          data: { number, method: input.method, ...(branchId ? { branchId } : {}) },
        },
        meta,
      );
    }
    const after = await customerFor(tx, customerId);
    const result: CustomerMoneyResult = {
      kind: 'payment',
      number,
      date,
      customerId: customer.id,
      customerName: customer.name,
      amountMinor: input.amountMinor,
      method: input.method,
      reference: input.reference ?? null,
      note: input.note ?? null,
      balanceBeforeMinor: after.balance + input.amountMinor,
      balanceAfterMinor: after.balance,
      baseCurrency: currency,
      ...(branchId ? { branchId } : {}),
    };
    // A request that lost the race to the same id posted nothing: it settles nothing either
    if (inside && posted !== null) await inside(tx, result);
    return result;
  });
}

/** A debt the customer already had when the store started on the system (against 3900). */
export async function openCustomerDebt(
  db: Database,
  auth: AccessClaims,
  customerId: string,
  input: CustomerOpeningDebtInput,
  meta: RequestMeta,
  now: Date,
): Promise<CustomerMoneyResult> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'accounting.post');
    const id = input.id ?? newId();
    await documentLock(tx, 'customer_opening_debt', id);
    const customer = await customerFor(tx, customerId);
    const currency: CurrencyCode = await baseCurrency(tx);
    // The same id sent again (a double click, a lost answer): answer with the entry already made, post nothing
    const [again] = await tx.execute<{
      number: string;
      date: string;
      amount: string;
      customer_id: string | null;
    }>(sql`
      select e.number, e.entry_date::text as date,
             (select coalesce(sum(l.debit_minor - l.credit_minor), 0)::text from journal_lines l
               join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
               where l.tenant_id = e.tenant_id and l.entry_id = e.id and a.code = '1200') as amount,
             (select l.party_id::text from journal_lines l where l.tenant_id = e.tenant_id and l.entry_id = e.id
               and l.party_type = 'customer' limit 1) as customer_id
      from journal_entries e where e.source_type = 'manual' and e.source_id = ${id} and e.kind = 'manual'`);
    if (again) {
      if (again.customer_id !== customer.id) {
        throw new AppError(409, 'conflict', 'هذا المعرّف استُعمل لقيد آخر.');
      }
      return {
        kind: 'opening_debt',
        number: again.number,
        date: again.date,
        customerId: customer.id,
        customerName: customer.name,
        amountMinor: Number(again.amount) || input.amountMinor,
        method: null,
        reference: null,
        note: null,
        balanceBeforeMinor: customer.balance - (Number(again.amount) || input.amountMinor),
        balanceAfterMinor: customer.balance,
        baseCurrency: currency,
      };
    }
    // An archived customer is off the till and out of the lists: a new debt there would be lost from view
    const [state] = await tx.execute<{ archived_at: string | null }>(
      sql`select archived_at from customers where id = ${customerId}`,
    );
    if (state?.archived_at) {
      throw new AppError(409, 'conflict', 'هذا الزبون مؤرشف. أعده أولاً ثم سجّل الدين.');
    }
    const date = await dayOf(tx, now, input.date);
    await assertDateOpen(tx, auth.tenantId, date);
    await postOpeningBalance(tx, auth, meta, {
      party: 'customer',
      partyId: customer.id,
      name: customer.name,
      balanceMinor: input.amountMinor,
      date,
      entryId: id,
    });
    const [entry] = await tx.execute<{ number: string }>(sql`
      select e.number from journal_entries e
      where e.source_type = 'manual' and e.source_id = ${id} and e.kind = 'manual'`);
    const after = await customerFor(tx, customerId);
    return {
      kind: 'opening_debt',
      number: entry?.number ?? '',
      date,
      customerId: customer.id,
      customerName: customer.name,
      amountMinor: input.amountMinor,
      method: null,
      reference: null,
      note: null,
      balanceBeforeMinor: customer.balance,
      balanceAfterMinor: after.balance,
      baseCurrency: currency,
    };
  });
}
