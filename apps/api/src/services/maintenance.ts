import { and, desc, eq, sql } from 'drizzle-orm';
import {
  contractState,
  daysBetween,
  nextVisitDay,
  plusDays,
  type CurrencyCode,
  type MaintenanceContract,
  type maintenanceInput,
  type maintenanceVisitInput,
} from '@serva/core';
import { maintenanceContracts, withTenant, type Database, type Transaction } from '@serva/db';
import type { z } from 'zod';
import type { DeviceClaims } from '../auth/device-guard';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import {
  baseCurrencyOf,
  ensureServiceItem,
  MAINTENANCE_ITEM_NAME,
  nextSeq,
  normalizeSerial,
  storeToday,
} from './contracts-common';

/**
 * Maintenance contracts (packages/core › contracts/maintenance.ts): devices serviced every N months
 * over a period, each visit logged, the price sold at the till as a «عقد صيانة» service line. Nothing
 * posts here.
 */

const notFound = () => new AppError(404, 'not_found', 'هذا العقد غير موجود.');
const stale = () => new AppError(409, 'stale_version', 'غيّر شخص آخر هذا العقد للتو. حدّث القائمة.');
const invalid = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);

/** A visit is due soon when it falls in this many days */
const UPCOMING_DAYS = 30;

const contractOf = (r: typeof maintenanceContracts.$inferSelect, today: string): MaintenanceContract => {
  const next = nextVisitDay(
    {
      startDate: r.startDate,
      endDate: r.endDate,
      visitEveryMonths: r.visitEveryMonths,
      cancelled: r.cancelled,
    },
    r.visits.length,
  );
  return {
    id: r.id,
    number: r.number,
    customerId: r.customerId,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    devices: r.devices,
    startDate: r.startDate,
    endDate: r.endDate,
    visitEveryMonths: r.visitEveryMonths,
    currency: r.currency as CurrencyCode,
    priceMinor: r.priceMinor,
    visits: r.visits,
    nextVisit: next,
    visitOverdue: next !== null && next < today,
    state: contractState(r, today),
    billedOn: r.billedOn,
    note: r.note,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
  };
};

async function load(tx: Transaction, id: string) {
  const [row] = await tx.select().from(maintenanceContracts).where(eq(maintenanceContracts.id, id));
  if (!row) throw notFound();
  return row;
}

export function listContracts(
  db: Database,
  auth: AccessClaims,
  view: 'all' | 'upcoming',
): Promise<{ items: MaintenanceContract[] }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const today = await storeToday(tx, auth.tenantId);
    const rows = await tx
      .select()
      .from(maintenanceContracts)
      .orderBy(desc(maintenanceContracts.seq))
      .limit(300);
    const all = rows.map((r) => contractOf(r, today));
    if (view === 'all') return { items: all };
    const upcoming = all
      .filter((c) => c.nextVisit !== null && daysBetween(today, c.nextVisit) <= UPCOMING_DAYS)
      .sort((a, b) => (a.nextVisit! < b.nextVisit! ? -1 : a.nextVisit! > b.nextVisit! ? 1 : 0));
    return { items: upcoming };
  });
}

/** Names the devices the store knows by serial; the rest keep what was typed */
async function namedDevices(
  tx: Transaction,
  devices: readonly { serial: string; item?: string | undefined }[],
) {
  const out: { serial: string; item: string }[] = [];
  for (const d of devices) {
    const serial = normalizeSerial(d.serial);
    const [known] = await tx.execute<{ item: string }>(sql`
      select p.name_ar || coalesce(' ' || v.label, '') as item
      from serials s
      join variants v on v.tenant_id = s.tenant_id and v.id = s.variant_id
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      where s.serial = ${serial}`);
    out.push({ serial, item: known?.item ?? (d.item?.trim() || serial) });
  }
  return out;
}

async function insertContract(
  tx: Transaction,
  tenantId: string,
  input: z.output<typeof maintenanceInput>,
  devices: { serial: string; item: string }[],
) {
  if (input.customerId) {
    const [known] = await tx.execute<{ id: string }>(
      sql`select id from customers where id = ${input.customerId}`,
    );
    if (!known) throw invalid({ customerId: 'هذا الزبون غير موجود.' });
  }
  const seq = await nextSeq(tx, tenantId, 'maintenance_contracts');
  const [made] = await tx
    .insert(maintenanceContracts)
    .values({
      tenantId,
      seq,
      number: `MC-${String(seq).padStart(6, '0')}`,
      customerId: input.customerId ?? null,
      customerName: input.customerName,
      customerPhone: input.customerPhone ?? null,
      devices,
      startDate: input.startDate,
      endDate: input.endDate,
      visitEveryMonths: input.visitEveryMonths,
      currency: await baseCurrencyOf(tx, tenantId),
      priceMinor: input.priceMinor,
      note: input.note || null,
    })
    .returning();
  await ensureServiceItem(tx, tenantId, MAINTENANCE_ITEM_NAME);
  return made!;
}

export function createContract(
  db: Database,
  auth: AccessClaims,
  input: z.output<typeof maintenanceInput>,
): Promise<MaintenanceContract> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const made = await insertContract(tx, auth.tenantId, input, await namedDevices(tx, input.devices));
    return contractOf(made, await storeToday(tx, auth.tenantId));
  });
}

export function logVisit(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: z.output<typeof maintenanceVisitInput>,
): Promise<MaintenanceContract> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const row = await load(tx, id);
    if (row.version !== input.version) throw stale();
    if (row.cancelled) throw invalid({ status: 'هذا العقد ملغى.' });
    const today = await storeToday(tx, auth.tenantId);
    const on = input.on ?? today;
    const [done] = await tx
      .update(maintenanceContracts)
      .set({
        visits: [...row.visits, { on, technician: input.technician, note: input.note || null }],
        updatedAt: sql`now()`,
      })
      .where(and(eq(maintenanceContracts.id, id), eq(maintenanceContracts.version, input.version)))
      .returning();
    if (!done) throw stale();
    return contractOf(done, today);
  });
}

/** A new contract for the same customer and devices, from the day after this one ends, for as long */
export function renewContract(
  db: Database,
  auth: AccessClaims,
  id: string,
  version: number,
): Promise<MaintenanceContract> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const row = await load(tx, id);
    if (row.version !== version) throw stale();
    if (row.cancelled) throw invalid({ status: 'هذا العقد ملغى.' });
    const startDate = plusDays(row.endDate, 1);
    const length = daysBetween(row.startDate, row.endDate);
    const made = await insertContract(
      tx,
      auth.tenantId,
      {
        customerId: row.customerId,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        devices: row.devices,
        startDate,
        endDate: plusDays(startDate, length),
        visitEveryMonths: row.visitEveryMonths,
        priceMinor: row.priceMinor,
        note: row.note,
      },
      row.devices,
    );
    return contractOf(made, await storeToday(tx, auth.tenantId));
  });
}

/** Contracts the till can still sell: not cancelled, not ended and not billed yet */
export function listUnbilledContracts(
  db: Database,
  device: DeviceClaims,
): Promise<{ items: MaintenanceContract[] }> {
  return withTenant(db, device.tenantId, async (tx) => {
    const today = await storeToday(tx, device.tenantId);
    const rows = await tx
      .select()
      .from(maintenanceContracts)
      .where(sql`${maintenanceContracts.billedOn} is null and not ${maintenanceContracts.cancelled}`)
      .orderBy(maintenanceContracts.startDate)
      .limit(200);
    return {
      items: rows.map((r) => contractOf(r, today)).filter((c) => c.state !== 'ended' && c.priceMinor > 0),
    };
  });
}

export function markBilled(
  db: Database,
  device: DeviceClaims,
  id: string,
  version: number,
): Promise<MaintenanceContract> {
  return withTenant(db, device.tenantId, async (tx) => {
    const row = await load(tx, id);
    if (row.version !== version) throw stale();
    const today = await storeToday(tx, device.tenantId);
    const [done] = await tx
      .update(maintenanceContracts)
      .set({ billedOn: today, updatedAt: sql`now()` })
      .where(and(eq(maintenanceContracts.id, id), eq(maintenanceContracts.version, version)))
      .returning();
    if (!done) throw stale();
    return contractOf(done, today);
  });
}
