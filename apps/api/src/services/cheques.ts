import { sql } from 'drizzle-orm';
import type { Cheque, ChequeStatus, CurrencyCode } from '@serva/core';
import { chequeActions, withTenant, type Database, type Transaction } from '@serva/db';
import { createUuidV7 } from '@serva/sync';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { postEntry } from './posting';

/**
 * Cheques (packages/core › contracts/cheques.ts). A cheque is a payment with method `cheque` of a
 * sale or a customer's receipt; nothing is copied: the list reads those payments and what the
 * owner did with each. Marking one posts its entry (source `cheque`, the action's id), so a
 * rebuild from the documents leaves it as it is.
 */

const newId = createUuidV7();

type Row = {
  source_type: 'sale' | 'receipt' | 'supplier_payment';
  source_id: string;
  payment_no: number;
  number: string;
  date: string;
  branch_id: string;
  customer_id: string | null;
  customer_name: string | null;
  reference: string | null;
  amount: string;
  currency: string;
  action: 'cleared' | 'bounced' | null;
  action_date: string | null;
  note: string | null;
  cheque: { bank?: string; number?: string; dueDate?: string; drawer?: string | null } | null;
  supplier_name: string | null;
};

const all = sql`
  select 'sale' as source_type, i.id as source_id, p.payment_no, i.number, i.business_date::text as date,
         i.branch_id, i.customer_id, coalesce(c.name, i.customer_name) as customer_name, p.reference,
         p.amount_minor::text as amount, p.currency,
         (select e->'cheque' from jsonb_array_elements(i.payload->'payments') e
           where (e->>'paymentNo')::int = p.payment_no limit 1) as cheque,
         null::text as supplier_name
  from invoice_payments p
  join invoices i on i.tenant_id = p.tenant_id and i.id = p.invoice_id
  left join customers c on c.tenant_id = i.tenant_id and c.id = i.customer_id
  where p.method = 'cheque'
  union all
  select 'receipt', r.id, 1, r.number, r.business_date::text, r.branch_id, r.customer_id,
         coalesce(c.name, r.payload->>'customerName'), r.reference, r.amount_minor::text, r.currency,
         r.payload->'cheque', null::text
  from receipts r
  left join customers c on c.tenant_id = r.tenant_id and c.id = r.customer_id
  where r.method = 'cheque'
  union all
  select 'supplier_payment', sp.id, 1, sp.number, sp.business_date::text,
         (select id from branches order by id limit 1), null::uuid, null::text,
         sp.cheque->>'number', sp.amount_minor::text, (select base_currency from tenant_settings limit 1),
         sp.cheque, s.name
  from supplier_payments sp
  join suppliers s on s.tenant_id = sp.tenant_id and s.id = sp.supplier_id
  where sp.cheque is not null`;

const view = (r: Row): Cheque => ({
  sourceType: r.source_type,
  sourceId: r.source_id,
  paymentNo: Number(r.payment_no),
  documentNumber: r.number,
  date: r.date,
  customerId: r.customer_id,
  customerName: r.customer_name,
  reference: r.reference,
  amountMinor: Number(r.amount),
  currency: r.currency as CurrencyCode,
  status: r.action ?? 'pending',
  actionDate: r.action_date,
  note: r.note,
  direction: r.source_type === 'supplier_payment' ? 'out' : 'in',
  bank: r.cheque?.bank ?? null,
  dueDate: r.cheque?.dueDate ?? null,
  drawer: r.cheque?.drawer ?? null,
  supplierName: r.supplier_name,
});

async function rows(tx: Transaction, where = sql`true`): Promise<Row[]> {
  return tx.execute<Row>(sql`
    select x.*, a.action, a.action_date::text as action_date, a.note
    from (${all}) x
    left join cheque_actions a
      on a.source_type = x.source_type and a.source_id = x.source_id and a.payment_no = x.payment_no
    where ${where}
    order by x.date desc, x.number desc, x.payment_no`);
}

export function listCheques(
  db: Database,
  auth: AccessClaims,
  status: ChequeStatus | undefined,
): Promise<{ items: Cheque[]; baseCurrency: CurrencyCode }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.view');
    const items = (await rows(tx)).map(view).filter((c) => !status || c.status === status);
    const [base] = await tx.execute<{ base: string }>(sql`select base_currency as base from tenant_settings`);
    return { items, baseCurrency: (base?.base ?? 'SYP') as CurrencyCode };
  });
}

export function actOnCheque(
  db: Database,
  auth: AccessClaims,
  input: {
    sourceType: 'sale' | 'receipt';
    sourceId: string;
    paymentNo: number;
    action: 'cleared' | 'bounced';
    date: string;
    note?: string | null | undefined;
  },
  meta: RequestMeta,
): Promise<Cheque> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.manage');
    const [row] = await rows(
      tx,
      sql`x.source_type = ${input.sourceType} and x.source_id = ${input.sourceId}
          and x.payment_no = ${input.paymentNo}`,
    );
    if (!row || row.source_type === 'supplier_payment') {
      throw new AppError(404, 'not_found', 'هذا الشيك غير موجود.');
    }
    if (row.action) {
      throw new AppError(409, 'conflict', 'سُجّل هذا الشيك من قبل، ولا يُسجّل مرتين.');
    }
    if (input.date < row.date) {
      throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
        date: 'التاريخ قبل يوم استلام الشيك',
      });
    }
    const id = newId();
    await tx.insert(chequeActions).values({
      tenantId: auth.tenantId,
      id,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      paymentNo: input.paymentNo,
      action: input.action,
      actionDate: input.date,
      note: input.note ?? null,
      createdBy: auth.userId,
    });
    const amount = Number(row.amount);
    const party = row.customer_id ? { type: 'customer' as const, id: row.customer_id } : null;
    const memo = `شيك ${row.reference ?? ''} من ${row.customer_name ?? 'زبون'}`.replace(/\s+/g, ' ');
    const entryId = await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId: row.branch_id,
      date: input.date,
      sourceType: 'cheque',
      sourceId: id,
      sourceNumber: row.number,
      memo: `${input.action === 'cleared' ? 'تحصيل' : 'رد'} ${memo}`,
      baseCurrency: row.currency,
      lines: [
        {
          account: { code: input.action === 'cleared' ? '1130' : '1200' },
          baseMinor: amount,
          currency: row.currency,
          amountMinor: amount,
          rate: null,
          party: input.action === 'bounced' ? party : null,
          memo,
        },
        {
          account: { code: '1160' },
          baseMinor: -amount,
          currency: row.currency,
          amountMinor: -amount,
          rate: null,
          party,
          memo,
        },
      ],
    });
    await tx.execute(sql`update cheque_actions set entry_id = ${entryId} where id = ${id}`);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: `cheque.${input.action}`,
        entity: 'cheque',
        entityId: id,
        data: { sourceType: input.sourceType, sourceId: input.sourceId, paymentNo: input.paymentNo, amount },
      },
      meta,
    );
    const [after] = await rows(
      tx,
      sql`x.source_id = ${input.sourceId} and x.payment_no = ${input.paymentNo}`,
    );
    return view(after!);
  });
}
