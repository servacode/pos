import { sql } from 'drizzle-orm';
import type { purchaseDueChangeInput } from '@serva/core';
import { purchaseDueChanges, withTenant, type Database } from '@serva/db';
import type { z } from 'zod';
import { inScope, requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { effectiveDue } from './purchases';

/**
 * Round 64: a supplier invoice's due date corrected after posting. Nothing is posted: the purchase stays as it was, a row
 * in purchase_due_changes says what the date is now, and the audit log says who changed it, from what, and why.
 * Only a credit invoice has a due date; a corrected (reversed) invoice owes nothing, so its date is left alone.
 */
export function changePurchaseDue(
  db: Database,
  auth: AccessClaims,
  purchaseId: string,
  input: z.output<typeof purchaseDueChangeInput>,
  meta: RequestMeta,
): Promise<{ purchaseId: string; dueDate: string | null; previousDueDate: string | null }> {
  const { tenantId, userId } = auth;
  return withTenant(db, tenantId, async (tx) => {
    const scope = await requirePermission(tx, userId, 'purchases.manage');
    const [row] = await tx.execute<{
      branch_id: string;
      payment: string;
      business_date: string;
      due: string | null;
      reversed: boolean;
    }>(sql`
      select p.branch_id, p.payment, p.business_date::text, (${effectiveDue})::text as due,
             exists (select 1 from purchase_reversals r where r.tenant_id = p.tenant_id and r.purchase_id = p.id) as reversed
      from purchases p where p.id = ${purchaseId}`);
    if (!row || !inScope(scope, row.branch_id)) {
      throw new AppError(404, 'not_found', 'هذه الفاتورة غير موجودة.');
    }
    const bad = (message: string) =>
      new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', { dueDate: message });
    if (row.payment !== 'credit') throw bad('الاستحقاق لفواتير الآجل فقط');
    if (row.reversed) throw bad('هذه الفاتورة صُحّحت ولا مستحق عليها');
    if (input.dueDate && input.dueDate < row.business_date) throw bad('تاريخ الاستحقاق قبل تاريخ الفاتورة');
    if ((input.dueDate ?? null) === row.due)
      return { purchaseId, dueDate: row.due, previousDueDate: row.due };
    await tx.insert(purchaseDueChanges).values({
      tenantId,
      purchaseId,
      dueDate: input.dueDate ?? null,
      previousDueDate: row.due,
      reason: input.reason ?? null,
      createdBy: userId,
    });
    await audit(
      tx,
      {
        tenantId,
        userId,
        action: 'purchase.due_changed',
        entity: 'purchase',
        entityId: purchaseId,
        changes: { dueDate: [row.due, input.dueDate ?? null] },
        ...(input.reason ? { reason: input.reason } : {}),
      },
      meta,
    );
    return { purchaseId, dueDate: input.dueDate ?? null, previousDueDate: row.due };
  });
}
