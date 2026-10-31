import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  barcodes,
  branches,
  categories,
  exchangeRates,
  prices,
  products,
  roles,
  stockLevels,
  syncTombstones,
  taxRates,
  tenantSettings,
  units,
  userRoles,
  users,
  variants,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
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
      version: branches.version,
    },
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
};

export const PULL_SET_NAMES = Object.keys(PULL_SETS);

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

export function unknownSets(names: string[]): void {
  const unknown = names.filter((name) => !(name in PULL_SETS));
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
  const names = Object.keys(cursors).length > 0 ? Object.keys(cursors) : PULL_SET_NAMES;
  unknownSets(names);
  return withTenant(db, device.tenantId, async (tx) => {
    const state = await readServerState(tx);
    const xmin = await currentXmin(tx);
    const sets: Record<string, PullSetPage> = {};
    const resync: string[] = [];
    let hasMore = false;
    for (const name of names) {
      const after = parseCursor(cursors[name] ?? INITIAL_CURSOR);
      // Tombstones older than the horizon are gone: a cursor before it cannot see those deletions.
      if (after.xid !== 0n && after.xid < state.tombstoneHorizon) {
        resync.push(name);
        continue;
      }
      const page = await pullSet(tx, device, PULL_SETS[name]!, name, after, xmin, limit);
      sets[name] = page.page;
      hasMore ||= page.hasMore;
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
