import { eq, sql } from 'drizzle-orm';
import { type SupplierInput, type SupplierListResponse, type SupplierRow } from '@serva/core';
import { suppliers, withTenant, type Database, type Transaction } from '@serva/db';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { newId, notFound, baseCurrency, supplierBalances } from './purchases-common';

// ─── Suppliers ───────────────────────────────────────────────────────────────

export async function supplierRows(tx: Transaction, id?: string): Promise<SupplierRow[]> {
  const rows = await tx.execute<{
    id: string;
    name: string;
    phone: string | null;
    notes: string | null;
    terms_days: number | null;
    archived_at: string | null;
    balance: string;
    usd_balance: string;
    usd_book: string;
    last_purchase: string | null;
    purchases_total: string;
  }>(sql`
    select s.id, s.name, s.phone, s.notes, s.terms_days, s.archived_at, coalesce(b.balance, 0)::text as balance,
           coalesce(b.usd_balance, 0)::text as usd_balance, coalesce(b.usd_book, 0)::text as usd_book,
           pu.last_purchase::text as last_purchase, coalesce(pu.total, 0)::text as purchases_total
    from suppliers s left join (${supplierBalances}) b on b.supplier_id = s.id
    left join (
      select p.supplier_id, max(p.business_date) as last_purchase, sum(p.total_minor) as total
      from purchases p
      where not exists (select 1 from purchase_reversals r where r.tenant_id = p.tenant_id and r.purchase_id = p.id)
      group by p.supplier_id
    ) pu on pu.supplier_id = s.id
    ${id ? sql`where s.id = ${id}` : sql``}
    order by s.name, s.id`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    notes: r.notes,
    termsDays: r.terms_days,
    balanceMinor: Number(r.balance),
    usdBalanceMinor: Number(r.usd_balance),
    usdBookMinor: Number(r.usd_book),
    archived: r.archived_at !== null,
    lastPurchaseOn: r.last_purchase,
    purchasesTotalMinor: Number(r.purchases_total),
  }));
}

export async function listSuppliers(db: Database, auth: AccessClaims): Promise<SupplierListResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const items = await supplierRows(tx);
    return {
      items,
      totalOwedMinor: items.reduce((sum, s) => sum + Math.max(0, s.balanceMinor), 0),
      baseCurrency: await baseCurrency(tx),
    };
  });
}

export async function saveSupplier(
  db: Database,
  auth: AccessClaims,
  id: string | null,
  input: SupplierInput,
  meta: RequestMeta,
  now: Date,
): Promise<SupplierRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    return saveSupplierTx(tx, auth, id, input, meta, now);
  });
}

/** The write of saveSupplier inside the caller's transaction (the import); permission checked by the caller. */
export async function saveSupplierTx(
  tx: Transaction,
  auth: AccessClaims,
  id: string | null,
  input: SupplierInput,
  meta: RequestMeta,
  now: Date,
): Promise<SupplierRow> {
  const fields = {
    name: input.name,
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.termsDays !== undefined ? { termsDays: input.termsDays } : {}),
    ...(input.archived !== undefined ? { archivedAt: input.archived ? now : null } : {}),
  };
  const supplierId = id ?? newId();
  if (id) {
    const [found] = await tx
      .update(suppliers)
      .set({ ...fields, updatedAt: now })
      .where(eq(suppliers.id, id))
      .returning();
    if (!found) throw notFound('هذا المورد');
  } else {
    await tx.insert(suppliers).values({ tenantId: auth.tenantId, id: supplierId, ...fields });
  }
  await audit(
    tx,
    {
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: id ? 'supplier.update' : 'supplier.create',
      entity: 'supplier',
      entityId: supplierId,
      changes: { name: [null, input.name] },
    },
    meta,
  );
  return (await supplierRows(tx, supplierId))[0]!;
}
