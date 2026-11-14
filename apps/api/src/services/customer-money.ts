import { sql } from 'drizzle-orm';
import {
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
import { baseCurrency, nextNumber } from './purchases';

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

const dayOf = (now: Date, date?: string) => date ?? now.toISOString().slice(0, 10);

/** A payment from a customer, into the safe or the method's account, against what they owe. */
export async function receiveCustomerPayment(
  db: Database,
  auth: AccessClaims,
  customerId: string,
  input: CustomerPaymentInput,
  meta: RequestMeta,
  now: Date,
): Promise<CustomerMoneyResult> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'receipt.create');
    const customer = await customerFor(tx, customerId);
    const currency: CurrencyCode = await baseCurrency(tx);
    const date = dayOf(now, input.date);
    const id = input.id ?? newId();
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
      branchId: null,
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
          data: { number, method: input.method },
        },
        meta,
      );
    }
    const after = await customerFor(tx, customerId);
    return {
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
    };
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
    const customer = await customerFor(tx, customerId);
    const currency: CurrencyCode = await baseCurrency(tx);
    const date = dayOf(now, input.date);
    await postOpeningBalance(tx, auth, meta, {
      party: 'customer',
      partyId: customer.id,
      name: customer.name,
      balanceMinor: input.amountMinor,
      date,
    });
    const [entry] = await tx.execute<{ number: string }>(sql`
      select e.number from journal_entries e
      join journal_lines l on l.tenant_id = e.tenant_id and l.entry_id = e.id
      where e.kind = 'manual' and l.party_type = 'customer' and l.party_id = ${customer.id}
      order by e.created_at desc, e.seq desc limit 1`);
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
