import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type {
  AlterationStatus,
  AlterationTicket,
  CurrencyCode,
  alterationInput,
  alterationStatusInput,
} from '@serva/core';
import { alterationTickets, withTenant, type Database } from '@serva/db';
import type { z } from 'zod';
import type { DeviceClaims } from '../auth/device-guard';
import { AppError } from '../errors';

/**
 * Alteration tickets (03 › الألبسة: التعديل والتقصير): numbered per store, made and followed on the
 * tills of a branch. received → ready → delivered (or straight to delivered); a ticket never goes
 * back. The fee is sold at the till as a service, so nothing posts here.
 */

const NEXT: Record<AlterationStatus, readonly AlterationStatus[]> = {
  received: ['ready', 'delivered'],
  ready: ['delivered'],
  delivered: [],
};

const notFound = () => new AppError(404, 'not_found', 'هذه التذكرة غير موجودة.');

const ticketOf = (r: typeof alterationTickets.$inferSelect): AlterationTicket => ({
  id: r.id,
  number: r.number,
  status: r.status as AlterationStatus,
  customerName: r.customerName,
  phone: r.phone,
  item: r.item,
  work: r.work,
  currency: r.currency as CurrencyCode,
  priceMinor: r.priceMinor,
  dueDate: r.dueDate,
  note: r.note,
  depositMinor: r.depositMinor,
  depositVoucher: r.depositVoucher,
  createdAt: r.createdAt.toISOString(),
  readyAt: r.readyAt?.toISOString() ?? null,
  deliveredAt: r.deliveredAt?.toISOString() ?? null,
  version: r.version,
});

export function createAlteration(
  db: Database,
  device: DeviceClaims,
  input: z.output<typeof alterationInput>,
): Promise<AlterationTicket> {
  return withTenant(db, device.tenantId, async (tx) => {
    const [settings] = await tx.execute<{ base: string }>(
      sql`select base_currency as base from tenant_settings where tenant_id = ${device.tenantId}`,
    );
    // Numbers follow each other within a store; the lock keeps two tills off the same one
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('alteration_tickets'), hashtext(${device.tenantId}))`,
    );
    const [last] = await tx.execute<{ seq: number | null }>(
      sql`select max(seq) as seq from alteration_tickets where tenant_id = ${device.tenantId}`,
    );
    const seq = (last?.seq ?? 0) + 1;
    const [made] = await tx
      .insert(alterationTickets)
      .values({
        tenantId: device.tenantId,
        seq,
        number: `ALT-${String(seq).padStart(6, '0')}`,
        branchId: device.branchId,
        deviceId: device.deviceId,
        customerName: input.customerName,
        phone: input.phone,
        item: input.item,
        work: input.work,
        currency: settings?.base ?? 'SYP',
        priceMinor: input.priceMinor,
        dueDate: input.dueDate,
        note: input.note || null,
        depositMinor: input.depositMinor,
        depositVoucher: input.depositMinor > 0 ? (input.depositVoucher ?? null) : null,
      })
      .returning();
    return ticketOf(made!);
  });
}

/** The branch's tickets: still open (received or ready), the soonest due first; or the latest 200 */
export function listAlterations(
  db: Database,
  device: DeviceClaims,
  status: 'open' | 'all',
): Promise<{ items: AlterationTicket[] }> {
  return withTenant(db, device.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(alterationTickets)
      .where(
        and(
          eq(alterationTickets.tenantId, device.tenantId),
          eq(alterationTickets.branchId, device.branchId),
          ...(status === 'open' ? [inArray(alterationTickets.status, ['received', 'ready'])] : []),
        ),
      )
      .orderBy(asc(alterationTickets.dueDate), asc(alterationTickets.seq))
      .limit(200);
    return { items: rows.map(ticketOf) };
  });
}

export function setAlterationStatus(
  db: Database,
  device: DeviceClaims,
  id: string,
  input: z.output<typeof alterationStatusInput>,
): Promise<AlterationTicket> {
  return withTenant(db, device.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(alterationTickets)
      .where(and(eq(alterationTickets.tenantId, device.tenantId), eq(alterationTickets.id, id)));
    if (!row || row.branchId !== device.branchId) throw notFound();
    if (row.version !== input.version) {
      throw new AppError(409, 'stale_version', 'غيّر جهاز آخر هذه التذكرة للتو. حدّث القائمة.');
    }
    if (!NEXT[row.status as AlterationStatus].includes(input.status)) {
      throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
        status: 'لا يمكن نقل التذكرة إلى هذه الحالة.',
      });
    }
    const [done] = await tx
      .update(alterationTickets)
      .set({
        status: input.status,
        ...(input.status === 'ready' ? { readyAt: sql`now()` } : { deliveredAt: sql`now()` }),
        updatedAt: sql`now()`,
      })
      .where(and(eq(alterationTickets.id, id), eq(alterationTickets.version, input.version)))
      .returning();
    if (!done) throw new AppError(409, 'stale_version', 'غيّر جهاز آخر هذه التذكرة للتو. حدّث القائمة.');
    return ticketOf(done);
  });
}
