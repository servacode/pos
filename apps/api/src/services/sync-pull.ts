import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  barcodes,
  branches,
  categories,
  customers,
  exchangeRates,
  noSaleReasons,
  onlineOrders,
  prices,
  products,
  promotions,
  regions,
  roles,
  routeCustomers,
  routes,
  salesOrders,
  serials,
  stockLevels,
  syncTombstones,
  taxRates,
  tenantSettings,
  units,
  userRoles,
  users,
  variants,
  vouchers,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import type { PharmacySettings } from '@serva/core';
import { CONTRACT_VERSION, INITIAL_CURSOR, type PullResponse, type PullSetPage } from '@serva/sync';
import type { DeviceClaims } from '../auth/device-guard';
import { AppError } from '../errors';
import { readServerState } from './sync-state';

/**
 * A set a device pulls: one table, the columns a device may see, and the column that is its id.
 * Columns not listed never leave the server (password and PIN hashes, phones, cost: 17 › الكلفة
 * لا تصل جهاز الكاشير أبداً). Every table carries change_xid and the tombstone trigger (catalog
 * test). The rows are exactly the contract's (packages/core › contracts/catalog.ts PullSetRows).
 * `scope` narrows a set to what the device's branch keeps (stock_levels: its own branch only).
 */
interface PullSet {
  table: PgTable & { changeXid: PgColumn };
  id: PgColumn;
  tenantId: PgColumn;
  columns: Record<string, PgColumn | SQL>;
  scope?: (device: PullScope) => SQL;
}

/** Whose rows a page holds: the store, and the device's branch for branch-scoped sets. */
export interface PullScope {
  tenantId: string;
  branchId: string;
}

const archivedFlag = (column: PgColumn) => sql<boolean>`(${column} is not null)`;

const PULL_SETS: Record<string, PullSet> = {
  settings: {
    table: tenantSettings,
    id: tenantSettings.tenantId,
    tenantId: tenantSettings.tenantId,
    columns: {
      baseCurrency: tenantSettings.baseCurrency,
      enabledCurrencies: tenantSettings.enabledCurrencies,
      taxInclusive: tenantSettings.taxInclusive,
      defaultTaxRateBp: tenantSettings.defaultTaxRateBp,
      cashRoundingSteps: tenantSettings.cashRoundingSteps,
      numberFormat: tenantSettings.numberFormat,
      receiptFooter: tenantSettings.receiptFooter,
      // From tenants: a change there touches this row (0011), so it is pulled again.
      storeName: sql<string>`(select t.name from tenants t where t.id = tenant_settings.tenant_id)`,
      taxNumber: sql<
        string | null
      >`(select t.tax_number from tenants t where t.id = tenant_settings.tenant_id)`,
      timezone: sql<string>`(select t.timezone from tenants t where t.id = tenant_settings.tenant_id)`,
      businessDayCutoff: tenantSettings.businessDayCutoff,
      shiftMode: tenantSettings.shiftMode,
      idleMinutes: tenantSettings.idleMinutes,
      scaleBarcode: tenantSettings.scaleBarcode,
      service: tenantSettings.service,
      loyalty: tenantSettings.loyalty,
      // A pharmacy or medical-supplies store gets the defaults for what its owner never chose, so its
      // tills enforce the batch rules (same as services/store.ts › pharmacyOf): the owner's values win
      pharmacy: sql<PharmacySettings | null>`case
        when exists (select 1 from tenants t
                     where t.id = tenant_settings.tenant_id and 'pharmacy' = any(t.sectors))
          then '{"prescription":"optional","blockNoBatch":true}'::jsonb || coalesce(tenant_settings.pharmacy, '{}'::jsonb)
        when exists (select 1 from tenants t
                     where t.id = tenant_settings.tenant_id and 'medical_supplies' = any(t.sectors))
          then '{"prescription":"optional","autoBatch":true,"blockNoBatch":true}'::jsonb
               || coalesce(tenant_settings.pharmacy, '{}'::jsonb)
        else tenant_settings.pharmacy end`,
      till: tenantSettings.till,
      // الأقساط: the store's rules, so the till can price a plan offline (null: off)
      installments: tenantSettings.installments,
      sectors: sql<string[]>`(select t.sectors from tenants t where t.id = tenant_settings.tenant_id)`,
      version: tenantSettings.version,
    },
  },
  branches: {
    table: branches,
    id: branches.id,
    tenantId: branches.tenantId,
    columns: {
      code: branches.code,
      name: branches.name,
      address: branches.address,
      phone: branches.phone,
      isActive: branches.isActive,
      // A van is a branch of kind van: a till tells it from a store by this (older caches have no kind: a store)
      kind: branches.kind,
      parentBranchId: branches.parentBranchId,
      vehiclePlate: branches.vehiclePlate,
      version: branches.version,
    },
    // A store's damaged-goods place (round 35, D7) is the server's own: no till ever lists it
    scope: () => sql`${branches.kind} <> 'damaged'`,
  },
  users: {
    table: users,
    id: users.id,
    tenantId: users.tenantId,
    // No PIN hash ever (16 › تخمين رمز PIN): only which keypad to show and when the PIN changed.
    columns: {
      fullName: users.fullName,
      status: users.status,
      pinLength: users.pinLength,
      pinVersion: users.pinVersion,
      version: users.version,
    },
  },
  roles: {
    table: roles,
    id: roles.id,
    tenantId: roles.tenantId,
    columns: {
      key: roles.key,
      name: roles.name,
      permissions: roles.permissions,
      maxDiscountBp: roles.maxDiscountBp,
      version: roles.version,
    },
  },
  user_roles: {
    table: userRoles,
    id: userRoles.id,
    tenantId: userRoles.tenantId,
    columns: {
      userId: userRoles.userId,
      roleId: userRoles.roleId,
      branchId: userRoles.branchId,
      version: userRoles.version,
    },
  },
  products: {
    table: products,
    id: products.id,
    tenantId: products.tenantId,
    columns: {
      nameAr: products.nameAr,
      nameEn: products.nameEn,
      categoryId: products.categoryId,
      brand: products.brand,
      type: products.type,
      status: products.status,
      unitId: products.unitId,
      taxRateId: products.taxRateId,
      sellOnPos: products.sellOnPos,
      genericName: products.genericName,
      requiresPrescription: products.requiresPrescription,
      controlled: products.controlled,
      tracksSerial: products.tracksSerial,
      warrantyMonths: products.warrantyMonths,
      modifiers: products.modifiers,
      archived: archivedFlag(products.archivedAt),
      version: products.version,
    },
  },
  variants: {
    table: variants,
    id: variants.id,
    tenantId: variants.tenantId,
    columns: {
      productId: variants.productId,
      sku: variants.sku,
      label: variants.label,
      attributes: variants.attributes,
      sortOrder: variants.sortOrder,
      nearestExpiry: variants.nearestExpiry,
      shelfBatches: variants.shelfBatches,
      // Its colour's picture (or any option value it has) first, else the product's main one
      // The columns are written with their table: a single-table select prints them bare, and inside
      // this subquery a bare product_id means the picture's own (so any product got the first picture)
      imageUrl: sql<string | null>`(
        select '/v1/images/' || i.tenant_id || '/' || i.upload_id || '?size=thumb'
        from product_images i
        where i.tenant_id = ${variants}."tenant_id" and i.product_id = ${variants}."product_id"
          and (i.option_value is null
               or exists (select 1 from jsonb_array_elements(${variants}."attributes") a
                          where a ->> 'value' = i.option_value))
        order by (i.option_value is null), i.sort_order, i.created_at
        limit 1)`,
      archived: archivedFlag(variants.archivedAt),
      version: variants.version,
    },
  },
  prices: {
    table: prices,
    id: prices.id,
    tenantId: prices.tenantId,
    columns: {
      variantId: sql<string>`${prices.id}`,
      currency: prices.currency,
      priceMinor: prices.priceMinor,
      minPriceMinor: prices.minPriceMinor,
      wholesalePriceMinor: prices.wholesalePriceMinor,
      priceChangedAt: prices.priceChangedAt,
      version: prices.version,
    },
  },
  barcodes: {
    table: barcodes,
    id: barcodes.id,
    tenantId: barcodes.tenantId,
    columns: {
      variantId: barcodes.variantId,
      code: barcodes.code,
      kind: barcodes.kind,
      packQty: barcodes.packQty,
      packName: barcodes.packName,
      packPriceMinor: barcodes.packPriceMinor,
      packWholesaleMinor: barcodes.packWholesaleMinor,
      version: barcodes.version,
    },
  },
  categories: {
    table: categories,
    id: categories.id,
    tenantId: categories.tenantId,
    columns: {
      name: categories.name,
      parentId: categories.parentId,
      sortOrder: categories.sortOrder,
      archived: archivedFlag(categories.archivedAt),
      version: categories.version,
    },
  },
  units: {
    table: units,
    id: units.id,
    tenantId: units.tenantId,
    columns: {
      name: units.name,
      symbol: units.symbol,
      allowsFraction: units.allowsFraction,
      version: units.version,
    },
  },
  tax_rates: {
    table: taxRates,
    id: taxRates.id,
    tenantId: taxRates.tenantId,
    columns: {
      name: taxRates.name,
      rateBp: taxRates.rateBp,
      kind: taxRates.kind,
      showOnReceipt: taxRates.showOnReceipt,
      archived: archivedFlag(taxRates.archivedAt),
      version: taxRates.version,
    },
  },
  stock_levels: {
    table: stockLevels,
    id: stockLevels.id,
    tenantId: stockLevels.tenantId,
    columns: {
      branchId: stockLevels.branchId,
      variantId: stockLevels.variantId,
      qty: stockLevels.qty,
      reservedQty: stockLevels.reservedQty,
      // What is left of each batch here (03 › الصيدليات): the till allocates a sale from it
      batches: stockLevels.batches,
      version: stockLevels.version,
    },
    // The device's own branch only (17 › السحب).
    scope: (device) => sql`${stockLevels.branchId} = ${device.branchId}`,
  },
  exchange_rates: {
    table: exchangeRates,
    id: exchangeRates.id,
    tenantId: exchangeRates.tenantId,
    columns: {
      unit: exchangeRates.unit,
      quote: exchangeRates.quote,
      rate: exchangeRates.rate,
      collectRate: exchangeRates.collectRate,
      minRate: exchangeRates.minRate,
      maxRate: exchangeRates.maxRate,
      effectiveAt: exchangeRates.effectiveAt,
      version: exchangeRates.version,
    },
  },
  customers: {
    table: customers,
    id: customers.id,
    tenantId: customers.tenantId,
    columns: {
      name: customers.name,
      phone: customers.phone,
      creditLimitMinor: customers.creditLimitMinor,
      priceTier: customers.priceTier,
      loyaltyPoints: customers.loyaltyPoints,
      // «المندوبون»: where he is, and whether the supervisor approved him (pending: cash only); additive, older clients ignore them
      regionId: customers.regionId,
      approvalStatus: customers.approvalStatus,
      lat: customers.lat,
      lng: customers.lng,
      // What a trade promotion targets («عروض التجار»); additive
      kind: customers.kind,
      archived: archivedFlag(customers.archivedAt),
      version: customers.version,
    },
    // A van's phone keeps only the customers on its rep's routes and the ones it added itself; every other device keeps all
    scope: (device) => sql`(
      not exists (select 1 from branches b where b.tenant_id = ${customers.tenantId} and b.id = ${device.branchId}::uuid and b.kind = 'van')
      or exists (select 1 from route_customers rc
                 join routes r on r.tenant_id = rc.tenant_id and r.id = rc.route_id
                 join sales_reps sr on sr.tenant_id = r.tenant_id and sr.id = r.rep_id
                 where rc.tenant_id = ${customers.tenantId} and rc.customer_id = ${customers.id}
                   and sr.van_branch_id = ${device.branchId}::uuid)
      or (${customers.createdByDoc} is not null and exists (
            select 1 from sync_inbox i join devices d on d.tenant_id = i.tenant_id and d.id = i.device_id
            where i.tenant_id = ${customers.tenantId} and i.doc_id = ${customers.createdByDoc}
              and d.branch_id = ${device.branchId}::uuid)))`,
  },
  vouchers: {
    table: vouchers,
    id: vouchers.id,
    tenantId: vouchers.tenantId,
    columns: {
      code: vouchers.code,
      currency: vouchers.currency,
      amountMinor: vouchers.amountMinor,
      redeemedMinor: vouchers.redeemedMinor,
      version: vouchers.version,
    },
  },
  promotions: {
    table: promotions,
    id: promotions.id,
    tenantId: promotions.tenantId,
    columns: {
      name: promotions.name,
      kind: promotions.kind,
      percentBp: promotions.percentBp,
      buyQty: promotions.buyQty,
      getQty: promotions.getQty,
      scope: promotions.scope,
      categoryIds: promotions.categoryIds,
      productIds: promotions.productIds,
      startsAt: promotions.startsAt,
      endsAt: promotions.endsAt,
      daysOfWeek: promotions.daysOfWeek,
      fromTime: promotions.fromTime,
      toTime: promotions.toTime,
      // Trade promotions (tiered, free_item) and who they are for; additive, older tills ignore them
      tiers: sql<{ minQty: number; percentBp: number }[]>`coalesce(${promotions.tiers}, '[]'::jsonb)`,
      freeVariantId: promotions.freeVariantId,
      freeQty: promotions.freeQty,
      customerKinds: promotions.customerKinds,
      priceTiers: promotions.priceTiers,
      repOnly: promotions.repOnly,
      // A coupon's offer is not for every sale: it reaches the till on the order that carries its code
      archived: sql<boolean>`(${promotions.archivedAt} is not null or ${promotions.couponCode} is not null)`,
      version: promotions.version,
    },
  },
  // Orders from the online shop for the till to sell (26 › حياة الطلب): accepted ones, and the ones
  // decided lately so a till sees an order it holds leave. Never a pending one.
  online_orders: {
    table: onlineOrders,
    id: onlineOrders.id,
    tenantId: onlineOrders.tenantId,
    columns: {
      number: onlineOrders.number,
      status: onlineOrders.status,
      customerName: onlineOrders.customerName,
      phone: onlineOrders.phone,
      fulfilment: onlineOrders.fulfilment,
      address: onlineOrders.address,
      note: onlineOrders.note,
      currency: onlineOrders.currency,
      totalMinor: onlineOrders.totalMinor,
      lines: onlineOrders.lines,
      depositCode: onlineOrders.depositCode,
      deliveryFeeMinor: onlineOrders.deliveryFeeMinor,
      deliveryArea: onlineOrders.deliveryArea,
      couponRule: onlineOrders.couponRule,
      // Round 37 (decision 14): the till counts what each hold reserves at its own branch, and until when
      branchId: onlineOrders.branchId,
      reservedUntil: onlineOrders.reservedUntil,
      version: onlineOrders.version,
    },
    scope: () =>
      sql`${onlineOrders.status} <> 'pending' and (${onlineOrders.status} = 'accepted' or ${onlineOrders.decidedAt} > now() - interval '30 days')`,
  },
  // The branch's pieces of serial-tracked products, in stock or sold lately (03 › الإلكترونيات): the
  // till refuses a number that is not in stock, offline too.
  serials: {
    table: serials,
    id: serials.id,
    tenantId: serials.tenantId,
    columns: {
      variantId: serials.variantId,
      serial: serials.serial,
      status: serials.status,
      saleNumber: sql<
        string | null
      >`(select i.number from invoices i where i.tenant_id = serials.tenant_id and i.id = serials.sale_id)`,
      version: serials.version,
    },
    scope: (device) =>
      sql`${serials.branchId} = ${device.branchId} and (${serials.status} in ('in_stock', 'rented') or ${serials.soldOn} > current_date - 45)`,
  },
};

/** The routes of the rep whose van is the device's branch */
const repOfVan = (device: PullScope, repId: SQL | PgColumn, tenantId: SQL | PgColumn) =>
  sql`exists (select 1 from sales_reps sr where sr.tenant_id = ${tenantId} and sr.id = ${repId}
              and sr.van_branch_id = ${device.branchId}::uuid)`;

/**
 * «المندوبون»: the sets only a rep's phone (a device of kind rep_phone) pulls, scoped to its van's
 * rep. Nothing here carries cost. A till never gets them, so older and ordinary clients are unaffected.
 */
const REP_PULL_SETS: Record<string, PullSet> = {
  regions: {
    table: regions,
    id: regions.id,
    tenantId: regions.tenantId,
    columns: {
      name: regions.name,
      parentId: regions.parentId,
      sortOrder: regions.sortOrder,
      isActive: regions.isActive,
      version: regions.version,
    },
  },
  routes: {
    table: routes,
    id: routes.id,
    tenantId: routes.tenantId,
    columns: {
      name: routes.name,
      regionId: routes.regionId,
      weekdays: routes.weekdays,
      repId: routes.repId,
      sortOrder: routes.sortOrder,
      isActive: routes.isActive,
      version: routes.version,
    },
    scope: (device) => repOfVan(device, routes.repId, routes.tenantId),
  },
  route_customers: {
    table: routeCustomers,
    id: routeCustomers.id,
    tenantId: routeCustomers.tenantId,
    columns: {
      routeId: routeCustomers.routeId,
      customerId: routeCustomers.customerId,
      visitOrder: routeCustomers.visitOrder,
      version: routeCustomers.version,
    },
    scope: (device) =>
      sql`exists (select 1 from routes r where r.tenant_id = ${routeCustomers.tenantId} and r.id = ${routeCustomers.routeId}
                  and ${repOfVan(device, sql`r.rep_id`, sql`r.tenant_id`)})`,
  },
  no_sale_reasons: {
    table: noSaleReasons,
    id: noSaleReasons.id,
    tenantId: noSaleReasons.tenantId,
    columns: {
      key: noSaleReasons.key,
      name: noSaleReasons.name,
      sortOrder: noSaleReasons.sortOrder,
      isActive: noSaleReasons.isActive,
      version: noSaleReasons.version,
    },
  },
  // Orders taken in or filled from this van: the open ones, and the ones changed lately so a phone sees one leave
  sales_orders: {
    table: salesOrders,
    id: salesOrders.id,
    tenantId: salesOrders.tenantId,
    columns: {
      number: salesOrders.number,
      status: salesOrders.status,
      customerId: salesOrders.customerId,
      branchId: salesOrders.branchId,
      warehouseBranchId: salesOrders.warehouseBranchId,
      repId: salesOrders.repId,
      businessDate: sql<string>`${salesOrders.businessDate}::text`,
      currency: salesOrders.currency,
      totalMinor: salesOrders.totalMinor,
      depositMinor: salesOrders.depositMinor,
      deliveryDate: sql<string | null>`${salesOrders.deliveryDate}::text`,
      lines: salesOrders.lines,
      version: salesOrders.version,
    },
    scope: (device) =>
      sql`(${salesOrders.branchId} = ${device.branchId}::uuid or ${salesOrders.warehouseBranchId} = ${device.branchId}::uuid)
          and (${salesOrders.status} in ('open', 'partial') or ${salesOrders.updatedAt} > now() - interval '30 days')`,
  },
};
Object.assign(PULL_SETS, REP_PULL_SETS);

export const PULL_SET_NAMES = Object.keys(PULL_SETS).filter((name) => !(name in REP_PULL_SETS));
/** The sets a rep's phone pulls on top of the usual ones (its bootstrap and its default pull) */
export const REP_PULL_SET_NAMES = Object.keys(REP_PULL_SETS);

/** The sets this device is served: the usual ones, plus the rep's when it is a rep_phone */
export async function setsFor(tx: Transaction, deviceId: string): Promise<string[]> {
  const [d] = await tx.execute<{ kind: string }>(sql`select kind from devices where id = ${deviceId}`);
  return d?.kind === 'rep_phone' ? [...PULL_SET_NAMES, ...REP_PULL_SET_NAMES] : PULL_SET_NAMES;
}

const MAX_UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

interface Key {
  xid: bigint;
  id: string;
}

function parseCursor(cursor: string): Key {
  const [xid, id] = cursor.split('.');
  return { xid: BigInt(xid!), id: id ?? MAX_UUID };
}

const compareKeys = (a: Key, b: Key) =>
  a.xid < b.xid ? -1 : a.xid > b.xid ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function unknownSets(names: string[], allowed?: readonly string[]): void {
  const unknown = names.filter(
    (name) => !(name in PULL_SETS) || (allowed ? !allowed.includes(name) : name in REP_PULL_SETS),
  );
  if (unknown.length > 0) {
    throw new AppError(400, 'validation_failed', 'مجموعة بيانات غير معروفة.', {
      cursors: unknown.join(', '),
    });
  }
}

/**
 * GET /v1/sync/pull. Per set, the rows and tombstones whose (change_xid, id) is after the device's
 * cursor and whose change_xid is below pg_snapshot_xmin of this moment: a transaction still open
 * now cannot commit later with a smaller id unseen (15 › السحب). Pages hold at most `limit` items
 * per set; a page that ends inside one transaction resumes after its last id.
 */
export async function pullChanges(
  db: Database,
  device: DeviceClaims,
  cursors: Record<string, string>,
  limit: number,
  now: Date,
): Promise<PullResponse> {
  return withTenant(db, device.tenantId, async (tx) => {
    const allowed = await setsFor(tx, device.deviceId);
    const names = Object.keys(cursors).length > 0 ? Object.keys(cursors) : allowed;
    unknownSets(names, allowed);
    const state = await readServerState(tx);
    const xmin = await currentXmin(tx);
    const sets: Record<string, PullSetPage> = {};
    const resync: string[] = [];
    // Sets the server asked this device to download again (a rep's route lost customers: the pull cannot say «delete»)
    const [asked] = await tx.execute<{ sets: string[] }>(
      sql`select resync_sets as sets from devices where id = ${device.deviceId}`,
    );
    const flagged = new Set(asked?.sets ?? []);
    let hasMore = false;
    for (const name of names) {
      const after = parseCursor(cursors[name] ?? INITIAL_CURSOR);
      // Tombstones older than the horizon are gone: a cursor before it cannot see those deletions.
      // A set the device has not pulled yet has nothing stale to forget: it is served from the start anyway
      if (after.xid !== 0n && (flagged.has(name) || after.xid < state.tombstoneHorizon)) {
        resync.push(name);
        continue;
      }
      const page = await pullSet(tx, device, PULL_SETS[name]!, name, after, xmin, limit);
      sets[name] = page.page;
      hasMore ||= page.hasMore;
    }
    // What the answer tells the device to download again is no longer owed
    const done = names.filter((name) => flagged.has(name));
    if (done.length > 0) {
      await tx.execute(sql`
        update devices set resync_sets = array(select s from unnest(resync_sets) s where s <> all(array[${sql.join(
          done.map((d) => sql`${d}`),
          sql`, `,
        )}]::text[]))
        where id = ${device.deviceId}`);
    }
    return {
      contractVersion: CONTRACT_VERSION,
      serverEpoch: state.serverEpoch,
      serverTime: now.toISOString(),
      sets,
      hasMore,
      commands: resync.length > 0 ? { resync } : {},
    };
  });
}

/**
 * One page of a set after a cursor, below the xmin bound. Pull and the bootstrap snapshot both
 * read sets only through this, so they cannot disagree.
 */
export async function pullSetPage(
  tx: Transaction,
  device: PullScope,
  name: string,
  cursor: string,
  xmin: bigint,
  limit: number,
): Promise<{ page: PullSetPage; hasMore: boolean }> {
  return pullSet(tx, device, PULL_SETS[name]!, name, parseCursor(cursor), xmin, limit);
}

/** pg_snapshot_xmin of this moment: every transaction below it has ended (15 › السحب). */
export async function currentXmin(tx: Transaction): Promise<bigint> {
  const [bound] = await tx.execute<{ xmin: string }>(
    sql`select pg_snapshot_xmin(pg_current_snapshot())::text as xmin`,
  );
  return BigInt(bound!.xmin);
}

async function pullSet(
  tx: Transaction,
  device: PullScope,
  set: PullSet,
  name: string,
  after: Key,
  xmin: bigint,
  limit: number,
): Promise<{ page: PullSetPage; hasMore: boolean }> {
  const afterCursor = (xid: SQL | PgColumn, id: SQL | PgColumn) =>
    sql`(${xid}, ${id}) > (${after.xid.toString()}::xid8, ${after.id}::uuid)`;

  const rows = await tx
    .select({
      ...set.columns,
      __id: set.id,
      __xid: sql<string>`${set.table.changeXid}::text`,
    })
    .from(set.table)
    .where(
      and(
        eq(set.tenantId, device.tenantId),
        afterCursor(set.table.changeXid, set.id),
        sql`${set.table.changeXid} < ${xmin.toString()}::xid8`,
        set.scope?.(device),
      ),
    )
    .orderBy(asc(set.table.changeXid), asc(set.id))
    .limit(limit);

  const tombstones = await tx
    .select({ id: syncTombstones.recordId, xid: sql<string>`${syncTombstones.changeXid}::text` })
    .from(syncTombstones)
    .where(
      and(
        eq(syncTombstones.tenantId, device.tenantId),
        eq(syncTombstones.collection, name),
        afterCursor(syncTombstones.changeXid, syncTombstones.recordId),
        sql`${syncTombstones.changeXid} < ${xmin.toString()}::xid8`,
      ),
    )
    .orderBy(asc(syncTombstones.changeXid), asc(syncTombstones.recordId))
    .limit(limit);

  type Item = Key & { row: Record<string, unknown> | null };
  const items: Item[] = [
    ...rows.map(({ __id, __xid, ...data }) => ({
      xid: BigInt(__xid),
      id: __id as string,
      row: { id: __id, ...data },
    })),
    ...tombstones.map((t) => ({ xid: BigInt(t.xid), id: t.id, row: null })),
  ].sort(compareKeys);
  const taken = items.slice(0, limit);
  const full = rows.length === limit || tombstones.length === limit || items.length > limit;

  // Within a page the last change of a record wins (deleted, then created again, or the reverse).
  const latest = new Map<string, Item>();
  for (const item of taken) latest.set(item.id, item);
  const upserts: PullSetPage['upserts'] = [];
  const deletes: string[] = [];
  for (const item of latest.values()) {
    if (item.row) upserts.push(item.row as PullSetPage['upserts'][number]);
    else deletes.push(item.id);
  }

  let cursor: string;
  if (full && taken.length > 0) {
    const last = taken.at(-1)!;
    cursor = `${last.xid}.${last.id}`;
  } else {
    // Everything below xmin has been sent: the next pull starts at xmin.
    const done = xmin - 1n;
    cursor = done >= after.xid ? done.toString() : cursorOf(after);
  }
  return { page: { upserts, deletes, cursor }, hasMore: full };
}

const cursorOf = (key: Key) => (key.id === MAX_UUID ? key.xid.toString() : `${key.xid}.${key.id}`);
