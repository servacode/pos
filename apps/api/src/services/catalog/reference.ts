import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type {
  Category,
  TaxKind,
  TaxRate,
  Unit,
  createCategoryInput,
  createTaxRateInput,
  createUnitInput,
  updateCategoryInput,
  updateTaxRateInput,
  updateUnitInput,
} from '@serva/core';
import { categories, taxRates, units, withTenant, type Database, type Transaction } from '@serva/db';
import type { z } from 'zod';
import { audit } from '../audit';
import {
  diff,
  fieldError,
  iso,
  notFound,
  requireCatalogManager,
  requireCatalogReader,
  requireOwner,
  staleVersion,
  type CatalogContext,
} from './common';

// Parsed inputs (defaults applied).
type CategoryCreate = z.output<typeof createCategoryInput>;
type CategoryUpdate = z.output<typeof updateCategoryInput>;
type UnitCreate = z.output<typeof createUnitInput>;
type UnitUpdate = z.output<typeof updateUnitInput>;
type TaxRateCreate = z.output<typeof createTaxRateInput>;
type TaxRateUpdate = z.output<typeof updateTaxRateInput>;

/** archived: true sets archivedAt now, false clears it, undefined leaves it. */
const archivedAtOf = (archived: boolean | undefined, current: Date | null, now: Date) =>
  archived === undefined ? undefined : archived ? (current ?? now) : null;

// ─── Categories ──────────────────────────────────────────────────────────────

const categoryNotFound = () => notFound('هذا التصنيف غير موجود.');

async function categoryViews(tx: Transaction, id?: string): Promise<Category[]> {
  const rows = await tx
    .select({
      id: categories.id,
      name: categories.name,
      parentId: categories.parentId,
      sortOrder: categories.sortOrder,
      archivedAt: categories.archivedAt,
      version: categories.version,
      productCount: sql<number>`(
        select count(*)::int from products p
        where p.tenant_id = categories.tenant_id and p.category_id = categories.id and p.archived_at is null)`,
    })
    .from(categories)
    .where(id ? eq(categories.id, id) : undefined)
    .orderBy(asc(categories.sortOrder), asc(categories.name), asc(categories.id));
  return rows.map((r) => ({ ...r, archivedAt: iso(r.archivedAt) }));
}

/** A parent must exist; on an update it cannot be the category itself or one of its children. */
async function checkParent(tx: Transaction, parentId: string | null, self?: string): Promise<void> {
  if (parentId === null) return;
  const [parent] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, parentId));
  if (!parent) throw fieldError('parentId', 'التصنيف الأب غير موجود');
  if (!self) return;
  const [loop] = await tx.execute<{ found: boolean }>(sql`
    with recursive up(id, parent_id) as (
      select id, parent_id from categories where id = ${parentId}
      union all
      select c.id, c.parent_id from categories c join up on c.id = up.parent_id
    )
    select exists (select 1 from up where id = ${self}) as found`);
  if (loop?.found) throw fieldError('parentId', 'لا يكون التصنيف أباً لنفسه أو لأحد أصله');
}

export async function listCategories(db: Database, ctx: CatalogContext): Promise<{ items: Category[] }> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireCatalogReader(tx, ctx.auth.userId);
    return { items: await categoryViews(tx) };
  });
}

export async function createCategory(
  db: Database,
  input: CategoryCreate,
  ctx: CatalogContext,
): Promise<Category> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireCatalogManager(tx, ctx.auth.userId);
    await checkParent(tx, input.parentId);
    const [row] = await tx
      .insert(categories)
      .values({ tenantId: ctx.auth.tenantId, ...input })
      .returning({ id: categories.id });
    await audit(
      tx,
      {
        tenantId: ctx.auth.tenantId,
        userId: ctx.auth.userId,
        action: 'category.created',
        entity: 'category',
        entityId: row!.id,
        data: input,
      },
      ctx.meta,
    );
    return (await categoryViews(tx, row!.id))[0]!;
  });
}

export async function updateCategory(
  db: Database,
  id: string,
  input: CategoryUpdate,
  ctx: CatalogContext,
): Promise<Category> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireCatalogManager(tx, ctx.auth.userId);
    const [current] = await tx.select().from(categories).where(eq(categories.id, id)).for('update');
    if (!current) throw categoryNotFound();
    if (current.version !== input.version) throw staleVersion();
    if (input.parentId !== undefined) await checkParent(tx, input.parentId, id);
    const next = {
      name: input.name,
      parentId: input.parentId,
      sortOrder: input.sortOrder,
      archivedAt: archivedAtOf(input.archived, current.archivedAt, ctx.now),
    };
    await tx
      .update(categories)
      .set({ ...next, updatedAt: ctx.now })
      .where(eq(categories.id, id));
    await audit(
      tx,
      {
        tenantId: ctx.auth.tenantId,
        userId: ctx.auth.userId,
        action: 'category.updated',
        entity: 'category',
        entityId: id,
        changes: diff(current, next),
      },
      ctx.meta,
    );
    return (await categoryViews(tx, id))[0]!;
  });
}

// ─── Units ───────────────────────────────────────────────────────────────────

const unitView = (u: typeof units.$inferSelect): Unit => ({
  id: u.id,
  name: u.name,
  symbol: u.symbol,
  allowsFraction: u.allowsFraction,
  isSystem: u.systemKey !== null,
  archivedAt: iso(u.archivedAt),
  version: u.version,
});

export async function listUnits(db: Database, ctx: CatalogContext): Promise<{ items: Unit[] }> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireCatalogReader(tx, ctx.auth.userId);
    const rows = await tx.select().from(units).orderBy(asc(units.createdAt), asc(units.id));
    return { items: rows.map(unitView) };
  });
}

export async function createUnit(db: Database, input: UnitCreate, ctx: CatalogContext): Promise<Unit> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireCatalogManager(tx, ctx.auth.userId);
    const [row] = await tx
      .insert(units)
      .values({ tenantId: ctx.auth.tenantId, ...input })
      .returning();
    await audit(
      tx,
      {
        tenantId: ctx.auth.tenantId,
        userId: ctx.auth.userId,
        action: 'unit.created',
        entity: 'unit',
        entityId: row!.id,
        data: input,
      },
      ctx.meta,
    );
    return unitView(row!);
  });
}

export async function updateUnit(
  db: Database,
  id: string,
  input: UnitUpdate,
  ctx: CatalogContext,
): Promise<Unit> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireCatalogManager(tx, ctx.auth.userId);
    const [current] = await tx.select().from(units).where(eq(units.id, id)).for('update');
    if (!current) throw notFound('هذه الوحدة غير موجودة.');
    if (current.version !== input.version) throw staleVersion();
    if (input.archived && current.systemKey !== null) {
      throw fieldError('archived', 'وحدات المتجر الأساسية تُعدَّل ولا تُؤرشف');
    }
    const next = {
      name: input.name,
      symbol: input.symbol,
      allowsFraction: input.allowsFraction,
      archivedAt: archivedAtOf(input.archived, current.archivedAt, ctx.now),
    };
    const [row] = await tx
      .update(units)
      .set({ ...next, updatedAt: ctx.now })
      .where(eq(units.id, id))
      .returning();
    await audit(
      tx,
      {
        tenantId: ctx.auth.tenantId,
        userId: ctx.auth.userId,
        action: 'unit.updated',
        entity: 'unit',
        entityId: id,
        changes: diff(current, next),
      },
      ctx.meta,
    );
    return unitView(row!);
  });
}

// ─── Tax rates ───────────────────────────────────────────────────────────────

const taxRateView = (r: typeof taxRates.$inferSelect): TaxRate => ({
  id: r.id,
  name: r.name,
  rateBp: r.rateBp,
  kind: r.kind as TaxKind,
  showOnReceipt: r.showOnReceipt,
  archivedAt: iso(r.archivedAt),
  version: r.version,
});

export async function listTaxRates(db: Database, ctx: CatalogContext): Promise<{ items: TaxRate[] }> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireCatalogReader(tx, ctx.auth.userId);
    const rows = await tx.select().from(taxRates).orderBy(asc(taxRates.createdAt), asc(taxRates.id));
    return { items: rows.map(taxRateView) };
  });
}

export async function createTaxRate(
  db: Database,
  input: TaxRateCreate,
  ctx: CatalogContext,
): Promise<TaxRate> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireOwner(tx, ctx.auth.userId);
    const [row] = await tx
      .insert(taxRates)
      .values({ tenantId: ctx.auth.tenantId, ...input })
      .returning();
    await audit(
      tx,
      {
        tenantId: ctx.auth.tenantId,
        userId: ctx.auth.userId,
        action: 'tax_rate.created',
        entity: 'tax_rate',
        entityId: row!.id,
        data: input,
      },
      ctx.meta,
    );
    return taxRateView(row!);
  });
}

export async function updateTaxRate(
  db: Database,
  id: string,
  input: TaxRateUpdate,
  ctx: CatalogContext,
): Promise<TaxRate> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireOwner(tx, ctx.auth.userId);
    const [current] = await tx.select().from(taxRates).where(eq(taxRates.id, id)).for('update');
    if (!current) throw notFound('هذه الضريبة غير موجودة.');
    if (current.version !== input.version) throw staleVersion();
    const next = {
      name: input.name,
      showOnReceipt: input.showOnReceipt,
      archivedAt: archivedAtOf(input.archived, current.archivedAt, ctx.now),
    };
    const [row] = await tx
      .update(taxRates)
      .set({ ...next, updatedAt: ctx.now })
      .where(eq(taxRates.id, id))
      .returning();
    await audit(
      tx,
      {
        tenantId: ctx.auth.tenantId,
        userId: ctx.auth.userId,
        action: 'tax_rate.updated',
        entity: 'tax_rate',
        entityId: id,
        changes: diff(current, next),
      },
      ctx.meta,
    );
    return taxRateView(row!);
  });
}

/** A live (not archived) row of these tables, for references from a product. */
export async function liveReference(
  tx: Transaction,
  table: typeof categories | typeof units | typeof taxRates,
  id: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), isNull(table.archivedAt)));
  return Boolean(row);
}
