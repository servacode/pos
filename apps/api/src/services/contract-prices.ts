import { and, eq, sql } from 'drizzle-orm';
import type {
  ContractPrice,
  ContractPriceForTill,
  CurrencyCode,
  CustomerKind,
  contractPriceInput,
  contractPriceListQuery,
} from '@serva/core';
import { contractPrices, withTenant, type Database, type Transaction } from '@serva/db';
import type { z } from 'zod';
import type { DeviceClaims } from '../auth/device-guard';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import { baseCurrencyOf, storeToday } from './contracts-common';

/**
 * Contract prices (packages/core › contracts/contract-prices.ts): what a customer, or every customer
 * of one type, pays for a product between two days. The till reads the ones that apply to the
 * customer it picked; nothing posts here.
 */

const notFound = () => new AppError(404, 'not_found', 'هذا السعر غير موجود.');
const stale = () => new AppError(409, 'stale_version', 'غيّر شخص آخر هذا السعر للتو. حدّث القائمة.');
const invalid = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);

type Row = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_kind: string | null;
  variant_id: string;
  item: string;
  currency: string;
  price_minor: string;
  valid_from: string;
  valid_to: string | null;
  note: string | null;
  version: number;
};

const priceOf = (r: Row): ContractPrice => ({
  id: r.id,
  customerId: r.customer_id,
  customerName: r.customer_name,
  customerKind: r.customer_kind as CustomerKind | null,
  variantId: r.variant_id,
  item: r.item,
  currency: r.currency as CurrencyCode,
  priceMinor: Number(r.price_minor),
  validFrom: r.valid_from,
  validTo: r.valid_to,
  note: r.note,
  version: r.version,
});

const selected = sql`
  select cp.id, cp.customer_id, c.name as customer_name, cp.customer_kind, cp.variant_id,
         p.name_ar || coalesce(' ' || v.label, '') as item, cp.currency, cp.price_minor::text,
         cp.valid_from::text, cp.valid_to::text, cp.note, cp.version
  from contract_prices cp
  join variants v on v.tenant_id = cp.tenant_id and v.id = cp.variant_id
  join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
  left join customers c on c.tenant_id = cp.tenant_id and c.id = cp.customer_id`;

async function readOne(tx: Transaction, id: string): Promise<ContractPrice> {
  const [row] = await tx.execute<Row>(sql`${selected} where cp.id = ${id}`);
  if (!row) throw notFound();
  return priceOf(row);
}

export function listContractPrices(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof contractPriceListQuery>,
): Promise<{ items: ContractPrice[] }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const rows = await tx.execute<Row>(sql`
      ${selected}
      where ${query.customerId ? sql`cp.customer_id = ${query.customerId}` : sql`true`}
        and ${query.kind ? sql`cp.customer_kind = ${query.kind}` : sql`true`}
        and ${query.variantId ? sql`cp.variant_id = ${query.variantId}` : sql`true`}
      order by c.name nulls last, cp.customer_kind, p.name_ar, cp.valid_from desc
      limit 500`);
    return { items: rows.map(priceOf) };
  });
}

async function check(tx: Transaction, input: z.output<typeof contractPriceInput>) {
  const [variant] = await tx.execute<{ id: string }>(
    sql`select id from variants where id = ${input.variantId}`,
  );
  if (!variant) throw invalid({ variantId: 'هذا المنتج غير موجود.' });
  if (input.customerId) {
    const [known] = await tx.execute<{ id: string }>(
      sql`select id from customers where id = ${input.customerId}`,
    );
    if (!known) throw invalid({ customerId: 'هذا الزبون غير موجود.' });
  }
}

export function createContractPrice(
  db: Database,
  auth: AccessClaims,
  input: z.output<typeof contractPriceInput>,
): Promise<ContractPrice> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    await check(tx, input);
    const [made] = await tx
      .insert(contractPrices)
      .values({
        tenantId: auth.tenantId,
        customerId: input.customerId ?? null,
        customerKind: input.customerId ? null : (input.customerKind ?? null),
        variantId: input.variantId,
        currency: await baseCurrencyOf(tx, auth.tenantId),
        priceMinor: input.priceMinor,
        validFrom: input.validFrom,
        validTo: input.validTo ?? null,
        note: input.note || null,
      })
      .returning({ id: contractPrices.id });
    return readOne(tx, made!.id);
  });
}

export function updateContractPrice(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: z.output<typeof contractPriceInput> & { version: number },
): Promise<ContractPrice> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const current = await readOne(tx, id);
    if (current.version !== input.version) throw stale();
    await check(tx, input);
    const [done] = await tx
      .update(contractPrices)
      .set({
        customerId: input.customerId ?? null,
        customerKind: input.customerId ? null : (input.customerKind ?? null),
        variantId: input.variantId,
        priceMinor: input.priceMinor,
        validFrom: input.validFrom,
        validTo: input.validTo ?? null,
        note: input.note || null,
        updatedAt: sql`now()`,
      })
      .where(and(eq(contractPrices.id, id), eq(contractPrices.version, input.version)))
      .returning({ id: contractPrices.id });
    if (!done) throw stale();
    return readOne(tx, id);
  });
}

export function deleteContractPrice(db: Database, auth: AccessClaims, id: string): Promise<void> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const gone = await tx
      .delete(contractPrices)
      .where(eq(contractPrices.id, id))
      .returning({ id: contractPrices.id });
    if (gone.length === 0) throw notFound();
  });
}

/**
 * The prices in force today for a customer: one per product, the customer's own over the one for
 * their type, the later start over the earlier.
 */
export function contractPricesForTill(
  db: Database,
  device: DeviceClaims,
  customerId: string,
): Promise<{ items: ContractPriceForTill[] }> {
  return withTenant(db, device.tenantId, async (tx) => {
    const today = await storeToday(tx, device.tenantId);
    const rows = await tx.execute<{ variant_id: string; currency: string; price_minor: string }>(sql`
      select distinct on (cp.variant_id) cp.variant_id, cp.currency, cp.price_minor::text
      from contract_prices cp
      where (cp.customer_id = ${customerId}
             or cp.customer_kind = (select kind from customers where id = ${customerId}))
        and cp.valid_from <= ${today}::date and (cp.valid_to is null or cp.valid_to >= ${today}::date)
      order by cp.variant_id, (cp.customer_id is not null) desc, cp.valid_from desc, cp.created_at desc`);
    return {
      items: rows.map((r) => ({
        variantId: r.variant_id,
        currency: r.currency as CurrencyCode,
        priceMinor: Number(r.price_minor),
      })),
    };
  });
}
