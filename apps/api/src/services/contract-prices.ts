import { and, eq, sql } from 'drizzle-orm';
import { CUSTOMER_KIND_LABELS } from '@serva/core';
import type {
  ContractPrice,
  ContractPriceForTill,
  CurrencyCode,
  CustomerKind,
  PriceListSheet,
  contractPriceInput,
  contractPriceListQuery,
  priceListSheetQuery,
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

async function pricesInForce(
  tx: Transaction,
  tenantId: string,
  customerId: string,
): Promise<ContractPriceForTill[]> {
  const today = await storeToday(tx, tenantId);
  const rows = await tx.execute<{ variant_id: string; currency: string; price_minor: string }>(sql`
    select distinct on (cp.variant_id) cp.variant_id, cp.currency, cp.price_minor::text
    from contract_prices cp
    where (cp.customer_id = ${customerId}
           or cp.customer_kind = (select kind from customers where id = ${customerId}))
      and cp.valid_from <= ${today}::date and (cp.valid_to is null or cp.valid_to >= ${today}::date)
    order by cp.variant_id, (cp.customer_id is not null) desc, cp.valid_from desc, cp.created_at desc`);
  return rows.map((r) => ({
    variantId: r.variant_id,
    currency: r.currency as CurrencyCode,
    priceMinor: Number(r.price_minor),
  }));
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
  return withTenant(db, device.tenantId, async (tx) => ({
    items: await pricesInForce(tx, device.tenantId, customerId),
  }));
}

/** What a quotation for this customer is priced with: the wholesale tier and the contract prices */
export function customerPricingForQuotation(
  db: Database,
  auth: AccessClaims,
  customerId: string,
): Promise<{ priceTier: 'retail' | 'wholesale'; items: ContractPriceForTill[] }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.manage');
    const [c] = await tx.execute<{ price_tier: string }>(
      sql`select price_tier from customers where id = ${customerId}`,
    );
    if (!c) throw invalid({ customerId: 'هذا الزبون غير موجود.' });
    return {
      priceTier: c.price_tier === 'wholesale' ? 'wholesale' : 'retail',
      items: await pricesInForce(tx, auth.tenantId, customerId),
    };
  });
}

/**
 * A price list to print: every live product with the price this customer (or this type of
 * customer) pays today. A contract price in force wins; else the wholesale price when the tier is
 * wholesale and the product has one; else the shelf price.
 */
export function priceListSheet(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof priceListSheetQuery>,
): Promise<PriceListSheet> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const today = await storeToday(tx, auth.tenantId);
    let forName: string;
    let kind: string | null = null;
    let customerId: string | null = null;
    let tier: 'retail' | 'wholesale' = query.tier ?? 'retail';
    if (query.customerId) {
      const [c] = await tx.execute<{ name: string; kind: string | null; price_tier: string }>(
        sql`select name, kind, price_tier from customers where id = ${query.customerId}`,
      );
      if (!c) throw invalid({ customerId: 'هذا الزبون غير موجود.' });
      forName = c.name;
      kind = c.kind;
      customerId = query.customerId;
      tier = c.price_tier === 'wholesale' ? 'wholesale' : 'retail';
    } else if (query.kind) {
      forName = query.kind;
      kind = query.kind;
    } else {
      throw invalid({ customerId: 'اختر زبوناً أو نوع زبائن.' });
    }
    const rows = await tx.execute<{
      variant_id: string;
      item: string;
      sku: string | null;
      price_minor: string;
      wholesale_minor: string | null;
      contract_minor: string | null;
    }>(sql`
      select v.id as variant_id, p.name_ar || coalesce(' ' || v.label, '') as item,
             -- the printed «الرمز»: the item code, else its piece barcode (many items have no code)
             coalesce(v.sku, (select b.code from barcodes b
                               where b.tenant_id = v.tenant_id and b.variant_id = v.id
                               order by (b.pack_qty = 1000) desc, b.created_at, b.id limit 1)) as sku,
             pr.price_minor::text, pr.wholesale_price_minor::text as wholesale_minor,
             (select cp.price_minor::text from contract_prices cp
               where cp.variant_id = v.id
                 and ((${customerId}::uuid is not null and cp.customer_id = ${customerId}::uuid)
                      or (${kind}::text is not null and cp.customer_kind = ${kind}::text))
                 and cp.valid_from <= ${today}::date and (cp.valid_to is null or cp.valid_to >= ${today}::date)
               order by (cp.customer_id is not null) desc, cp.valid_from desc, cp.created_at desc
               limit 1) as contract_minor
      from variants v
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      join prices pr on pr.tenant_id = v.tenant_id and pr.id = v.id
      where v.archived_at is null and p.archived_at is null and p.type = 'stock'
      order by p.name_ar, v.sort_order, v.label
      limit 3000`);
    return {
      forName: kind && !customerId ? (CUSTOMER_KIND_LABELS[kind as CustomerKind] ?? forName) : forName,
      tier,
      currency: await baseCurrencyOf(tx, auth.tenantId),
      asOf: today,
      rows: rows.map((r) => {
        if (r.contract_minor !== null) {
          return {
            variantId: r.variant_id,
            item: r.item,
            sku: r.sku,
            priceMinor: Number(r.contract_minor),
            source: 'contract' as const,
          };
        }
        if (tier === 'wholesale' && r.wholesale_minor !== null) {
          return {
            variantId: r.variant_id,
            item: r.item,
            sku: r.sku,
            priceMinor: Number(r.wholesale_minor),
            source: 'wholesale' as const,
          };
        }
        return {
          variantId: r.variant_id,
          item: r.item,
          sku: r.sku,
          priceMinor: Number(r.price_minor),
          source: 'retail' as const,
        };
      }),
    };
  });
}
