import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  MAX_IMAGE_BYTES,
  MAX_PURCHASE_ATTACHMENTS,
  MAX_THUMB_BYTES,
  type PurchaseAttachment,
  type SupplierDueResponse,
  type purchaseAttachmentInput,
} from '@serva/core';
import { purchaseAttachments, purchases, uploads, withTenant, type Database } from '@serva/db';
import type { z } from 'zod';
import { inScope, requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { sniffImage, purchaseAttachmentUrl } from './catalog/images';
import { baseCurrency, storeDay, supplierBalances } from './purchases';

/**
 * Round 62: «مستحق هذا الأسبوع» and the photo of the paper invoice (contracts/purchases.ts).
 * Nothing here posts: a due date and a photo only describe an invoice already posted.
 */

const addDays = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * The credit invoices still owed that fall due within `days` days (or already have). A supplier's payments are not tied to
 * invoices, so what is open is worked out the way a shop thinks of it: payments settle the oldest invoices first, which
 * leaves the supplier's balance sitting on the newest ones. A supplier owed nothing (or owing the store) shows nothing.
 */
export function supplierDues(
  db: Database,
  auth: AccessClaims,
  days: number,
  now: Date,
): Promise<SupplierDueResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'purchases.manage');
    const today = await storeDay(tx, now);
    const until = addDays(today, days);
    const rows = await tx.execute<{
      id: string;
      number: string;
      reference: string | null;
      supplier_id: string;
      supplier_name: string;
      due_date: string;
      open: string;
      branch_id: string;
    }>(sql`
      with owed as (
        select p.tenant_id, p.id, p.number, p.reference, p.supplier_id, p.due_date, p.total_minor, p.branch_id, b.balance,
               sum(p.total_minor) over (partition by p.supplier_id order by p.business_date desc, p.number desc) as cum
        from purchases p
        join (${supplierBalances}) b on b.supplier_id = p.supplier_id and b.balance > 0
        where p.payment = 'credit'
          and not exists (select 1 from purchase_reversals r where r.tenant_id = p.tenant_id and r.purchase_id = p.id)
      )
      select o.id, o.number, o.reference, o.supplier_id, s.name as supplier_name, o.due_date::text as due_date,
             least(o.total_minor, greatest(0, o.balance - (o.cum - o.total_minor)))::text as open, o.branch_id
      from owed o join suppliers s on s.tenant_id = o.tenant_id and s.id = o.supplier_id
      where o.due_date is not null and o.due_date <= ${until}::date
        and least(o.total_minor, greatest(0, o.balance - (o.cum - o.total_minor))) > 0
      order by o.due_date, o.number`);
    const mine = rows.filter((r) => inScope(scope, r.branch_id));
    const items = mine.map((r) => ({
      purchaseId: r.id,
      number: r.number,
      reference: r.reference,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      dueDate: r.due_date,
      openMinor: Number(r.open),
      overdueDays:
        r.due_date < today
          ? Math.round(
              (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.due_date}T00:00:00Z`)) / 86_400_000,
            )
          : 0,
    }));
    return {
      items,
      totalMinor: items.reduce((sum, i) => sum + i.openMinor, 0),
      overdueMinor: items.filter((i) => i.overdueDays > 0).reduce((sum, i) => sum + i.openMinor, 0),
      baseCurrency: await baseCurrency(tx),
    };
  });
}

/** A photo of a supplier's paper invoice, stored like a product picture (the upload table); a few per invoice */
export function attachPurchasePhoto(
  db: Database,
  auth: AccessClaims,
  purchaseId: string,
  input: z.output<typeof purchaseAttachmentInput>,
  meta: RequestMeta,
): Promise<PurchaseAttachment> {
  const { tenantId, userId } = auth;
  return withTenant(db, tenantId, async (tx) => {
    const scope = await requirePermission(tx, userId, 'purchases.manage');
    const [purchase] = await tx
      .select({ id: purchases.id, branchId: purchases.branchId })
      .from(purchases)
      .where(eq(purchases.id, purchaseId));
    if (!purchase || !inScope(scope, purchase.branchId)) {
      throw new AppError(404, 'not_found', 'هذه الفاتورة غير موجودة.');
    }
    const data = Buffer.from(input.data, 'base64');
    const thumb = Buffer.from(input.thumb, 'base64');
    const bad = (field: string, message: string) =>
      new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', { [field]: message });
    if (data.length > MAX_IMAGE_BYTES) throw bad('data', 'الصورة أكبر من المسموح');
    if (thumb.length > MAX_THUMB_BYTES) throw bad('thumb', 'الصورة المصغّرة أكبر من المسموح');
    if (sniffImage(data) !== input.contentType || sniffImage(thumb) !== input.contentType) {
      throw bad('data', 'هذا الملف ليس صورة. اختر صورة JPG أو PNG أو WebP.');
    }
    const sha256 = createHash('sha256').update(data).digest('hex');
    const [same] = await tx
      .select({ id: uploads.id })
      .from(uploads)
      .where(
        and(
          eq(uploads.tenantId, tenantId),
          eq(uploads.sha256, sha256),
          eq(uploads.kind, 'purchase_attachment'),
        ),
      )
      .limit(1);
    let uploadId = same?.id;
    if (!uploadId) {
      const [made] = await tx
        .insert(uploads)
        .values({
          tenantId,
          kind: 'purchase_attachment',
          contentType: input.contentType,
          sha256,
          width: input.width,
          height: input.height,
          data,
          thumb,
          createdBy: userId,
        })
        .returning({ id: uploads.id });
      uploadId = made!.id;
    }
    const [held] = await tx.execute<{ n: string }>(
      sql`select count(*)::text as n from purchase_attachments where purchase_id = ${purchaseId}`,
    );
    if (Number(held?.n ?? 0) >= MAX_PURCHASE_ATTACHMENTS) {
      throw bad('data', `للفاتورة ${MAX_PURCHASE_ATTACHMENTS} صور، وهذا الحد. احذف صورة لتضيف غيرها.`);
    }
    const [row] = await tx
      .insert(purchaseAttachments)
      .values({ tenantId, purchaseId, uploadId, createdBy: userId })
      .onConflictDoNothing()
      .returning({ id: purchaseAttachments.id });
    let attachmentId = row?.id;
    if (!attachmentId) {
      const [same] = await tx
        .select({ id: purchaseAttachments.id })
        .from(purchaseAttachments)
        .where(
          and(eq(purchaseAttachments.purchaseId, purchaseId), eq(purchaseAttachments.uploadId, uploadId)),
        );
      attachmentId = same!.id;
    }
    await audit(
      tx,
      {
        tenantId,
        userId,
        action: 'purchase.attachment',
        entity: 'purchase',
        entityId: purchaseId,
        data: { bytes: data.length },
      },
      meta,
    );
    return {
      id: attachmentId,
      url: purchaseAttachmentUrl(purchaseId, attachmentId),
      thumbUrl: purchaseAttachmentUrl(purchaseId, attachmentId, true),
    };
  });
}

/** Takes a photo off an invoice (the picture itself stays: another invoice or a product may share it) */
export function removePurchasePhoto(
  db: Database,
  auth: AccessClaims,
  purchaseId: string,
  attachmentId: string,
  meta: RequestMeta,
): Promise<void> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'purchases.manage');
    const [purchase] = await tx
      .select({ branchId: purchases.branchId })
      .from(purchases)
      .where(eq(purchases.id, purchaseId));
    if (!purchase || !inScope(scope, purchase.branchId)) {
      throw new AppError(404, 'not_found', 'هذه الفاتورة غير موجودة.');
    }
    const gone = await tx
      .delete(purchaseAttachments)
      .where(and(eq(purchaseAttachments.id, attachmentId), eq(purchaseAttachments.purchaseId, purchaseId)))
      .returning({ id: purchaseAttachments.id });
    if (gone.length === 0) throw new AppError(404, 'not_found', 'هذه الصورة غير موجودة.');
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'purchase.attachment_removed',
        entity: 'purchase',
        entityId: purchaseId,
        data: { attachmentId },
      },
      meta,
    );
  });
}

/** The bytes of one invoice photo: same permission and branch scope as adding it; 404 for anything else */
export function readPurchasePhoto(
  db: Database,
  auth: AccessClaims,
  purchaseId: string,
  attachmentId: string,
  thumb: boolean,
): Promise<{ contentType: string; body: Buffer }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'purchases.manage');
    const [purchase] = await tx
      .select({ branchId: purchases.branchId })
      .from(purchases)
      .where(eq(purchases.id, purchaseId));
    if (!purchase || !inScope(scope, purchase.branchId)) {
      throw new AppError(404, 'not_found', 'هذه الفاتورة غير موجودة.');
    }
    const [row] = await tx
      .select({ contentType: uploads.contentType, data: thumb ? uploads.thumb : uploads.data })
      .from(purchaseAttachments)
      .innerJoin(
        uploads,
        and(eq(uploads.tenantId, purchaseAttachments.tenantId), eq(uploads.id, purchaseAttachments.uploadId)),
      )
      .where(
        and(
          eq(purchaseAttachments.id, attachmentId),
          eq(purchaseAttachments.purchaseId, purchaseId),
          eq(uploads.kind, 'purchase_attachment'),
        ),
      );
    if (!row) throw new AppError(404, 'not_found', 'هذه الصورة غير موجودة.');
    return { contentType: row.contentType, body: row.data };
  });
}
