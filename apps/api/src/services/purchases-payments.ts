import { eq, sql } from 'drizzle-orm';
import {
  businessDateOf,
  type CurrencyCode,
  type PurchaseCurrencyCode,
  type SupplierOpeningBalanceInput,
  type SupplierOpeningBalanceResult,
  type SupplierPaymentInput,
  type SupplierPaymentRow,
} from '@serva/core';
import { supplierPayments, suppliers, withTenant, type Database, type Transaction } from '@serva/db';
import { forbidden, inScope, requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { assertDateOpen } from './period-close';
import { postEntry, type DraftLine } from './posting';
import { bookValueOfPayment, usdTerms, usdToBase } from './purchase-usd';
import {
  newId,
  notFound,
  invalid,
  documentLock,
  baseCurrency,
  branchOf,
  nextNumber,
  PAY_ACCOUNT,
} from './purchases-common';
import { supplierRows } from './purchases-suppliers';

export async function paySupplier(
  db: Database,
  auth: AccessClaims,
  input: SupplierPaymentInput,
  meta: RequestMeta,
  now: Date = new Date(),
): Promise<SupplierPaymentRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    // Round 44: an id the form made posts once; the same id again answers the payment already made
    if (input.id) {
      await documentLock(tx, 'supplier_payment', input.id);
      const [made] = await tx.select().from(supplierPayments).where(eq(supplierPayments.id, input.id));
      if (made) {
        return {
          id: made.id,
          number: made.number,
          supplierId: made.supplierId,
          date: made.businessDate,
          amountMinor: made.currency ? (made.foreignMinor ?? made.amountMinor) : made.amountMinor,
          method: made.method as 'cash' | 'bank',
          ...(made.currency
            ? {
                currency: 'USD' as const,
                rate: made.rate,
                baseMinor: made.amountMinor,
                fxMinor: made.fxMinor ?? 0,
              }
            : {}),
        };
      }
    }
    // Round 44: the supplier row is locked, so two payments at once cannot both pass the «more than owed» check
    // nor price the dollar book value from the same stale balance
    const [supplier] = await tx
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, input.supplierId))
      .for('update');
    if (!supplier) throw invalid({ supplierId: 'اختر المورد' });
    const currency = await baseCurrency(tx);
    // A payment in dollars (round 36, decision 11) pays the supplier's dollar debt, from the dollar safe or the bank
    const usd = await usdTerms(tx, currency, input);
    if (usd && input.cheque)
      throw invalid({ currency: 'الشيك يُكتب بالليرة. اختر الدفع من الخزنة أو من البنك' });
    const row = (await supplierRows(tx, supplier.id))[0]!;
    const owed = usd ? row.usdBalanceMinor! : row.balanceMinor - row.usdBookMinor!;
    if (input.amountMinor > Math.max(0, owed) && !input.advance) {
      const message = usd
        ? owed > 0
          ? 'المبلغ أكبر مما للمورد عليك بالدولار. إن كانت دفعة مقدّمة فأكّد ذلك'
          : 'لا شيء مستحق لهذا المورد بالدولار الآن. إن كانت دفعة مقدّمة فأكّد ذلك'
        : owed > 0
          ? 'المبلغ أكبر مما للمورد عليك. إن كانت دفعة مقدّمة فأكّد ذلك'
          : row.usdBalanceMinor! > 0
            ? 'لا شيء مستحق لهذا المورد بالليرة. ما عليك له دولار: ادفع بالدولار، أو أكّد أنها دفعة مقدّمة'
            : 'لا شيء مستحق لهذا المورد الآن. إن كانت دفعة مقدّمة فأكّد ذلك';
      throw new AppError(409, 'conflict', message, { amountMinor: message });
    }
    const id = input.id ?? newId();
    const number = await nextNumber(tx, auth.tenantId, 'PAY', input.date);
    const method = input.cheque ? 'bank' : input.method;
    // Round 47: a cheque dated after today has not left the bank yet: it waits in 2150 «شيكات مستحقة الدفع»
    // (the supplier is paid in the books, the bank is not touched) until the owner marks it cleared
    const chequePayable = !!input.cheque && input.cheque.dueDate > (await storeDay(tx, now));
    // Dollars paid cost what they cost at today's rate; the books held that debt at its own rates, and
    // the difference is the exchange difference of the payment
    const paidBase = usd ? usdToBase(input.amountMinor, usd, currency) : input.amountMinor;
    const bookBase = usd
      ? bookValueOfPayment(
          input.amountMinor,
          { usdMinor: row.usdBalanceMinor!, bookMinor: row.usdBookMinor! },
          (dollars) => usdToBase(dollars, usd, currency),
        )
      : input.amountMinor;
    const fx = paidBase - bookBase;
    await tx.insert(supplierPayments).values({
      tenantId: auth.tenantId,
      id,
      number,
      supplierId: supplier.id,
      businessDate: input.date,
      amountMinor: paidBase,
      method,
      cheque: input.cheque ?? null,
      chequePayable,
      ...(usd ? { currency: 'USD', foreignMinor: input.amountMinor, rate: usd.rate.rate, fxMinor: fx } : {}),
      note: input.note ?? null,
      createdBy: auth.userId,
    });
    const paidCurrency = usd ? usd.currency : currency;
    await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId: await branchOf(tx, undefined),
      date: input.date,
      sourceType: 'supplier_payment',
      sourceId: id,
      sourceNumber: number,
      memo: `سند دفع ${number} إلى ${supplier.name}${usd ? ` بالدولار على سعر ${usd.rate.rate}` : ''}`,
      baseCurrency: currency,
      lines: [
        {
          account: { code: '2100' },
          baseMinor: bookBase,
          currency: paidCurrency,
          amountMinor: input.amountMinor,
          rate: null,
          party: { type: 'supplier', id: supplier.id },
          memo: supplier.name,
        },
        {
          account: chequePayable ? { code: '2150' } : PAY_ACCOUNT(method, paidCurrency),
          baseMinor: -paidBase,
          currency: paidCurrency,
          amountMinor: -input.amountMinor,
          rate: usd?.rate ?? null,
          ...(chequePayable ? { memo: `شيك ${input.cheque!.number} يستحق ${input.cheque!.dueDate}` } : {}),
        },
        // A loss when the dollars cost more than the books held them at (a debit), a gain when less
        ...(fx !== 0
          ? [
              {
                account: { code: '6510' },
                baseMinor: fx,
                currency,
                amountMinor: fx,
                rate: null,
                memo: fx > 0 ? 'خسارة فرق الصرف' : 'ربح فرق الصرف',
              } satisfies DraftLine,
            ]
          : []),
      ],
    });
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'supplier.payment',
        entity: 'supplier',
        entityId: supplier.id,
        changes: { amountMinor: [null, input.amountMinor], ...(usd ? { fxMinor: [null, fx] } : {}) },
      },
      meta,
    );
    return {
      id,
      number,
      supplierId: supplier.id,
      date: input.date,
      amountMinor: input.amountMinor,
      method,
      ...(usd ? { currency: 'USD' as const, rate: usd.rate.rate, baseMinor: paidBase, fxMinor: fx } : {}),
    };
  });
}

/** The store's business day now (its timezone and day cut-off) */
export async function storeDay(tx: Transaction, now: Date): Promise<string> {
  const [row] = await tx.execute<{ timezone: string; cutoff: string }>(sql`
    select t.timezone, s.business_day_cutoff as cutoff
    from tenant_settings s join tenants t on t.id = s.tenant_id`);
  return row ? businessDateOf(now, row.timezone, row.cutoff) : now.toISOString().slice(0, 10);
}

// ─── A supplier's opening balance (round 47) ─────────────────────────────────

/**
 * What the store owed a supplier (or the supplier owed the store) before it started on the system, against 3900
 * «الأرصدة الافتتاحية», the account the product import uses for opening stock:
 *   debt:   Dr 3900 / Cr 2100 for the supplier;    credit: Dr 2100 for the supplier / Cr 3900.
 * A manual entry dated the store's day (or the day given), so the owner sees it in the journal and the statement,
 * refused in a closed period. In dollars the 2100 line is kept in dollars at the rate, like any dollar debt.
 * The same `id` answers the entry already made and posts nothing twice.
 */
export async function openSupplierBalance(
  db: Database,
  auth: AccessClaims,
  supplierId: string,
  input: SupplierOpeningBalanceInput,
  meta: RequestMeta,
  now: Date,
): Promise<SupplierOpeningBalanceResult> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'purchases.manage');
    const branchId = await branchOf(tx, undefined);
    if (!inScope(scope, branchId)) throw forbidden();
    const id = input.id ?? newId();
    await documentLock(tx, 'supplier_opening', id);
    // The supplier row is locked so the balance before and after is not read between two writers
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, supplierId)).for('update');
    if (!supplier) throw notFound('هذا المورد');
    const currency = await baseCurrency(tx);
    const usd = await usdTerms(tx, currency, input);
    const paidCurrency: CurrencyCode = usd ? usd.currency : currency;
    const before = (await supplierRows(tx, supplier.id))[0]!.balanceMinor;
    const sign = input.kind === 'debt' ? 1 : -1;
    const [made] = await tx.execute<{ number: string; entry_date: string; supplier_id: string | null }>(sql`
      select e.number, e.entry_date::text as entry_date,
             (select l.party_id::text from journal_lines l where l.tenant_id = e.tenant_id and l.entry_id = e.id
               and l.party_type = 'supplier' limit 1) as supplier_id
      from journal_entries e where e.source_type = 'manual' and e.source_id = ${id} and e.kind = 'manual'`);
    const result = (number: string, date: string, after: number): SupplierOpeningBalanceResult => ({
      id,
      number,
      supplierId: supplier.id,
      supplierName: supplier.name,
      kind: input.kind,
      date,
      amountMinor: input.amountMinor,
      currency: paidCurrency as PurchaseCurrencyCode,
      balanceBeforeMinor: before,
      balanceAfterMinor: after,
    });
    if (made) {
      if (made.supplier_id !== supplier.id) {
        throw new AppError(409, 'conflict', 'هذا المعرّف استُعمل لقيد آخر.');
      }
      return result(made.number, made.entry_date, before);
    }
    const date = input.date ?? (await storeDay(tx, now));
    await assertDateOpen(tx, auth.tenantId, date);
    const base = usd ? usdToBase(input.amountMinor, usd, currency) : input.amountMinor;
    const memo = `رصيد افتتاحي — ${supplier.name}`;
    // Debit-signed: a debt the store owes is a credit on 2100 (negative), an advance a debit
    const supplierBase = -sign * base;
    const supplierOwn = -sign * input.amountMinor;
    const entryId = await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId: null,
      date,
      sourceType: 'manual',
      sourceId: id,
      sourceNumber: null,
      memo,
      baseCurrency: currency,
      lines: [
        {
          account: { code: '2100' },
          baseMinor: supplierBase,
          currency: paidCurrency,
          amountMinor: supplierOwn,
          rate: usd?.rate ?? null,
          party: { type: 'supplier', id: supplier.id },
          memo,
        },
        {
          account: { code: '3900' },
          baseMinor: -supplierBase,
          currency,
          amountMinor: -supplierBase,
          rate: null,
          memo,
        },
      ],
      kind: 'manual',
      createdBy: auth.userId,
    });
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'supplier.opening_balance',
        entity: 'supplier',
        entityId: supplier.id,
        changes: { balanceMinor: [before, before + sign * base] },
        data: { kind: input.kind, amountMinor: input.amountMinor, currency: paidCurrency },
      },
      meta,
    );
    const [entry] = await tx.execute<{ number: string }>(
      sql`select number from journal_entries where id = ${entryId}`,
    );
    return result(entry?.number ?? '', date, before + sign * base);
  });
}
