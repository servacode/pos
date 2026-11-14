import { and, desc, eq, sql } from 'drizzle-orm';
import {
  rentalCharge,
  rentalOverdue,
  type CurrencyCode,
  type RentableUnit,
  type Rental,
  type RentalRateUnit,
  type rentalInput,
} from '@serva/core';
import { rentals, withTenant, type Database, type Transaction } from '@serva/db';
import type { z } from 'zod';
import type { DeviceClaims } from '../auth/device-guard';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import {
  baseCurrencyOf,
  ensureServiceItem,
  nextSeq,
  normalizeSerial,
  RENTAL_ITEM_NAME,
  storeToday,
} from './contracts-common';

/**
 * Device rentals (packages/core › contracts/rentals.ts). A piece goes out against its serial, which
 * turns «rented» and so is not sold meanwhile; the return computes the charge and puts it back. The
 * charge is sold at the till as a «إيجار» service line, so nothing posts here.
 */

const notFound = () => new AppError(404, 'not_found', 'هذا التأجير غير موجود.');
const stale = () => new AppError(409, 'stale_version', 'غيّر جهاز آخر هذا التأجير للتو. حدّث القائمة.');
const invalid = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);

const rentalOf = (r: typeof rentals.$inferSelect, today: string): Rental => ({
  id: r.id,
  number: r.number,
  status: r.status as Rental['status'],
  overdue: rentalOverdue(r.status, r.expectedReturn, today),
  serial: r.serial,
  item: r.item,
  customerId: r.customerId,
  customerName: r.customerName,
  customerPhone: r.customerPhone,
  startDate: r.startDate,
  expectedReturn: r.expectedReturn,
  rateUnit: r.rateUnit as RentalRateUnit,
  rateMinor: r.rateMinor,
  currency: r.currency as CurrencyCode,
  depositMinor: r.depositMinor,
  depositVoucher: r.depositVoucher,
  note: r.note,
  returnedOn: r.returnedOn,
  chargeMinor:
    r.status === 'returned' && r.chargeMinor !== null
      ? r.chargeMinor
      : rentalCharge(r.startDate, today, r.rateUnit as RentalRateUnit, r.rateMinor),
  version: r.version,
  createdAt: r.createdAt.toISOString(),
});

async function list(tx: Transaction, tenantId: string, status: 'out' | 'all', branchId?: string) {
  const today = await storeToday(tx, tenantId);
  const rows = await tx
    .select()
    .from(rentals)
    .where(
      and(
        eq(rentals.tenantId, tenantId),
        ...(status === 'out' ? [eq(rentals.status, 'out')] : []),
        ...(branchId ? [eq(rentals.branchId, branchId)] : []),
      ),
    )
    .orderBy(status === 'out' ? sql`${rentals.expectedReturn} asc` : desc(rentals.seq))
    .limit(200);
  return { items: rows.map((r) => rentalOf(r, today)) };
}

export function listRentalsForDevice(db: Database, device: DeviceClaims, status: 'out' | 'all') {
  return withTenant(db, device.tenantId, (tx) => list(tx, device.tenantId, status, device.branchId));
}

export function listRentalsForAdmin(db: Database, auth: AccessClaims, status: 'out' | 'all') {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.view');
    return list(tx, auth.tenantId, status);
  });
}

/** Pieces of rentable products that are in the store now, matching what was typed */
export function rentableUnits(
  db: Database,
  device: DeviceClaims,
  q: string | undefined,
): Promise<{ items: RentableUnit[] }> {
  return withTenant(db, device.tenantId, async (tx) => {
    const typed = normalizeSerial(q ?? '');
    const rows = await tx.execute<{ serial: string; variant_id: string; item: string }>(sql`
      select s.serial, s.variant_id, p.name_ar || coalesce(' ' || v.label, '') as item
      from serials s
      join variants v on v.tenant_id = s.tenant_id and v.id = s.variant_id
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      where s.status = 'in_stock' and p.rentable
        and ${typed ? sql`s.serial like ${`%${typed}%`}` : sql`true`}
      order by p.name_ar, s.serial
      limit 50`);
    return { items: rows.map((r) => ({ serial: r.serial, variantId: r.variant_id, item: r.item })) };
  });
}

export function createRental(
  db: Database,
  device: DeviceClaims,
  input: z.output<typeof rentalInput>,
): Promise<Rental> {
  return withTenant(db, device.tenantId, async (tx) => {
    const serial = normalizeSerial(input.serial);
    const today = await storeToday(tx, device.tenantId);
    const startDate = input.startDate ?? today;
    if (input.expectedReturn < startDate) {
      throw invalid({ expectedReturn: 'يوم الإرجاع قبل يوم البداية' });
    }
    const [piece] = await tx.execute<{
      id: string;
      variant_id: string;
      status: string;
      rentable: boolean;
      item: string;
    }>(sql`
      select s.id, s.variant_id, s.status, p.rentable, p.name_ar || coalesce(' ' || v.label, '') as item
      from serials s
      join variants v on v.tenant_id = s.tenant_id and v.id = s.variant_id
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      where s.serial = ${serial}
      for update of s`);
    if (!piece) throw invalid({ serial: 'هذا الرقم التسلسلي غير موجود في المحل.' });
    if (!piece.rentable) throw invalid({ serial: 'هذه القطعة ليست من الأصناف القابلة للتأجير.' });
    if (piece.status === 'rented') throw invalid({ serial: 'هذه القطعة مؤجَّرة الآن.' });
    if (piece.status !== 'in_stock') throw invalid({ serial: 'هذه القطعة ليست في المحل.' });
    if (input.customerId) {
      const [known] = await tx.execute<{ id: string }>(
        sql`select id from customers where id = ${input.customerId}`,
      );
      if (!known) throw invalid({ customerId: 'هذا الزبون غير موجود.' });
    }
    const seq = await nextSeq(tx, device.tenantId, 'rentals');
    const [made] = await tx
      .insert(rentals)
      .values({
        tenantId: device.tenantId,
        seq,
        number: `RNT-${String(seq).padStart(6, '0')}`,
        branchId: device.branchId,
        deviceId: device.deviceId,
        serial,
        variantId: piece.variant_id,
        item: piece.item,
        customerId: input.customerId ?? null,
        customerName: input.customerName,
        customerPhone: input.phone,
        startDate,
        expectedReturn: input.expectedReturn,
        rateUnit: input.rateUnit,
        rateMinor: input.rateMinor,
        currency: await baseCurrencyOf(tx, device.tenantId),
        depositMinor: input.depositMinor,
        depositVoucher: input.depositMinor > 0 ? (input.depositVoucher ?? null) : null,
        note: input.note || null,
      })
      .returning();
    await tx.execute(sql`update serials set status = 'rented' where id = ${piece.id}`);
    await ensureServiceItem(tx, device.tenantId, RENTAL_ITEM_NAME);
    return rentalOf(made!, today);
  });
}

/** The piece is back: the rental closes with its charge and the serial is in the store again */
export function returnRental(
  db: Database,
  device: DeviceClaims,
  id: string,
  version: number,
): Promise<Rental> {
  return withTenant(db, device.tenantId, async (tx) => {
    const [row] = await tx.select().from(rentals).where(eq(rentals.id, id));
    if (!row || row.branchId !== device.branchId) throw notFound();
    if (row.version !== version) throw stale();
    if (row.status !== 'out') {
      throw invalid({ status: 'هذه القطعة أُعيدت من قبل.' });
    }
    const today = await storeToday(tx, device.tenantId);
    const [done] = await tx
      .update(rentals)
      .set({
        status: 'returned',
        returnedOn: today,
        chargeMinor: rentalCharge(row.startDate, today, row.rateUnit as RentalRateUnit, row.rateMinor),
        updatedAt: sql`now()`,
      })
      .where(and(eq(rentals.id, id), eq(rentals.version, version)))
      .returning();
    if (!done) throw stale();
    await tx.execute(
      sql`update serials set status = 'in_stock' where serial = ${row.serial} and status = 'rented'`,
    );
    return rentalOf(done, today);
  });
}
