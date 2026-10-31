import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  branches,
  roles,
  syncTombstones,
  tenantSettings,
  userRoles,
  users,
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
 * لا تصل جهاز الكاشير أبداً). Products, prices, customers and stock join with their tables in
 * phase 1; every one of them carries change_xid and the tombstone trigger (catalog test).
 */
interface PullSet {
  table: PgTable & { changeXid: PgColumn };
  id: PgColumn;
  tenantId: PgColumn;
  columns: Record<string, PgColumn>;
}

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
    columns: { fullName: users.fullName, status: users.status, version: users.version },
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
    throw new AppError(400, 'validation_failed', 'مجموعة مزامنة غير معروفة.', {
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
      const page = await pullSet(tx, device.tenantId, PULL_SETS[name]!, name, after, xmin, limit);
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
  tenantId: string,
  name: string,
  cursor: string,
  xmin: bigint,
  limit: number,
): Promise<{ page: PullSetPage; hasMore: boolean }> {
  return pullSet(tx, tenantId, PULL_SETS[name]!, name, parseCursor(cursor), xmin, limit);
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
  tenantId: string,
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
        eq(set.tenantId, tenantId),
        afterCursor(set.table.changeXid, set.id),
        sql`${set.table.changeXid} < ${xmin.toString()}::xid8`,
      ),
    )
    .orderBy(asc(set.table.changeXid), asc(set.id))
    .limit(limit);

  const tombstones = await tx
    .select({ id: syncTombstones.recordId, xid: sql<string>`${syncTombstones.changeXid}::text` })
    .from(syncTombstones)
    .where(
      and(
        eq(syncTombstones.tenantId, tenantId),
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
