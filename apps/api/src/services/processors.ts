import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  cashMovementPayloadSchema,
  salePayloadSchema,
  shiftClosePayloadSchema,
  shiftOpenPayloadSchema,
  verifySalePayload,
  type Approval,
} from '@serva/core';
import {
  cashMovements,
  invoiceLines,
  invoicePayments,
  invoices,
  products,
  shifts,
  stockLevels,
  stockMovements,
  variants,
  type Transaction,
} from '@serva/db';
import type { SyncFlag } from '@serva/sync';
import { postCashMovement, postSale, postShiftClose } from './posting';
import type { DocumentContext, SyncProcessors } from './sync-push';

/**
 * What the server does with the phase-1 documents once they are accepted (17 › الإرسال), inside
 * the document's own savepoint: store them, move stock, and flag what needs a look. A printed
 * sale is never refused here (08 › قاعدة 8): an unknown variant, a missing shift, negative stock
 * or totals that differ from the engine's are accepted and flagged. Each document is processed
 * once (the inbox answers replays), and every insert is keyed by the document id, so a second
 * run could not move stock twice. Each also posts its journal entry here (services/posting.ts),
 * in the same savepoint, so a document and its entry are stored together or not at all.
 */

/** approval_offline when someone approved without a connection (contract: approvals). */
const offlineApproval = (approvals: (Approval | null | undefined)[]): SyncFlag[] =>
  approvals.some((a) => a?.offline) ? ['approval_offline'] : [];

/** Whether the shift's opening has arrived, so a sale or a movement can point at it. */
async function shiftOpened(tx: Transaction, shiftId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.id, shiftId), isNotNull(shifts.openedAt)));
  return Boolean(row);
}

/** A sale: the invoice, its lines and payments, and stock out of the device's branch. */
async function processSale({ tx, device, doc }: DocumentContext) {
  const sale = salePayloadSchema.parse(doc.payload);
  const flags: SyncFlag[] = [];
  if (verifySalePayload(sale).length > 0) flags.push('totals_mismatch');
  flags.push(
    ...offlineApproval([sale.invoiceDiscount?.approval, ...sale.lines.map((l) => l.discount?.approval)]),
  );

  const { tenantId } = device;
  // Stock moves for stocked variants this store knows; services and unknown ids move nothing.
  const ids = [...new Set(sale.lines.map((l) => l.variantId))];
  const stocked = new Set(
    (
      await tx
        .select({ id: variants.id })
        .from(variants)
        .innerJoin(
          products,
          and(eq(products.tenantId, variants.tenantId), eq(products.id, variants.productId)),
        )
        .where(and(inArray(variants.id, ids), eq(products.type, 'stock')))
    ).map((v) => v.id),
  );
  let negative = false;
  for (const line of sale.lines) {
    if (!stocked.has(line.variantId) || line.baseQty === 0) continue;
    const [moved] = await tx
      .insert(stockMovements)
      .values({
        tenantId,
        branchId: device.branchId,
        variantId: line.variantId,
        qty: -line.baseQty,
        kind: 'sale',
        docId: doc.id,
        lineNo: line.lineNo,
        businessDate: doc.businessDate,
      })
      .onConflictDoNothing()
      .returning({ id: stockMovements.id });
    if (!moved) continue;
    const [level] = await tx
      .insert(stockLevels)
      .values({ tenantId, branchId: device.branchId, variantId: line.variantId, qty: -line.baseQty })
      .onConflictDoUpdate({
        target: [stockLevels.tenantId, stockLevels.branchId, stockLevels.variantId],
        set: { qty: sql`${stockLevels.qty} + excluded.qty` },
      })
      .returning({ qty: stockLevels.qty });
    if (level!.qty < 0) negative = true;
  }
  if (negative) flags.push('negative_stock');

  const [inserted] = await tx
    .insert(invoices)
    .values({
      tenantId,
      id: doc.id,
      branchId: device.branchId,
      deviceId: device.deviceId,
      number: doc.number!,
      businessDate: doc.businessDate,
      deviceTime: new Date(doc.deviceTime),
      shiftId: sale.shiftId,
      shiftLinked: await shiftOpened(tx, sale.shiftId),
      cashierId: sale.cashierId,
      salespersonId: sale.salespersonId,
      customerId: sale.customerId,
      customerName: sale.customerName,
      currency: sale.currency,
      taxInclusive: sale.taxInclusive,
      grossMinor: sale.totals.grossMinor,
      discountMinor: sale.totals.discountMinor,
      taxMinor: sale.totals.taxMinor,
      totalMinor: sale.totals.totalMinor,
      tipMinor: sale.tipMinor,
      roundingBaseMinor: sale.cashRounding?.roundingBaseMinor ?? 0,
      changeBaseMinor: sale.change?.baseAmountMinor ?? 0,
      flags,
      payload: doc.payload,
    })
    .onConflictDoNothing()
    .returning({ id: invoices.id });
  if (!inserted) return { flags };

  await tx.insert(invoiceLines).values(
    sale.lines.map((l) => ({
      tenantId,
      invoiceId: doc.id,
      lineNo: l.lineNo,
      productId: l.productId,
      variantId: l.variantId,
      name: l.name,
      barcode: l.barcode,
      packQty: l.packQty,
      qty: l.qty,
      baseQty: l.baseQty,
      priceCurrency: l.priceCurrency,
      priceMinor: l.priceMinor,
      unitPriceMinor: l.unitPriceMinor,
      taxRateId: l.taxRateId,
      taxRateBp: l.taxRateBp,
      grossMinor: l.priced.grossMinor,
      discountMinor: l.priced.lineDiscountMinor + l.priced.invoiceDiscountShareMinor,
      taxMinor: l.priced.taxMinor,
      totalMinor: l.priced.totalMinor,
    })),
  );
  if (sale.payments.length > 0) {
    await tx.insert(invoicePayments).values(
      sale.payments.map((p) => ({
        tenantId,
        invoiceId: doc.id,
        paymentNo: p.paymentNo,
        method: p.method,
        currency: p.currency,
        amountMinor: p.amountMinor,
        rate: p.rate,
        baseAmountMinor: p.baseAmountMinor,
        reference: p.reference,
        cardLast4: p.cardLast4,
        cardBrand: p.cardBrand,
        providerAccountId: p.providerAccountId,
      })),
    );
  }
  await postSale(
    tx,
    {
      tenantId,
      branchId: device.branchId,
      docId: doc.id,
      number: doc.number!,
      businessDate: doc.businessDate,
    },
    sale,
  );

  return { flags };
}

/** Sales and movements that named this shift before it arrived are linked to it now. */
async function linkToShift(tx: Transaction, shiftId: string): Promise<void> {
  await tx
    .update(invoices)
    .set({ shiftLinked: true })
    .where(and(eq(invoices.shiftId, shiftId), eq(invoices.shiftLinked, false)));
  await tx
    .update(cashMovements)
    .set({ shiftLinked: true })
    .where(and(eq(cashMovements.shiftId, shiftId), eq(cashMovements.shiftLinked, false)));
}

/** shift_open: the shift's id is the document's; a close that came first keeps its status. */
async function processShiftOpen({ tx, device, doc }: DocumentContext) {
  const open = shiftOpenPayloadSchema.parse(doc.payload);
  const fields = {
    number: doc.number,
    openedBy: open.openedBy,
    mode: open.mode,
    handoverFromShiftId: open.handoverFromShiftId,
    opening: open.opening,
    openedAt: new Date(doc.deviceTime),
    businessDate: doc.businessDate,
  };
  await tx
    .insert(shifts)
    .values({
      tenantId: device.tenantId,
      id: doc.id,
      branchId: device.branchId,
      deviceId: device.deviceId,
      ...fields,
    })
    .onConflictDoUpdate({
      target: [shifts.tenantId, shifts.id],
      set: fields,
      where: isNull(shifts.openedAt),
    });
  await linkToShift(tx, doc.id);
}

/** shift_close: closes the shift, or records it closed when its opening has not arrived yet. */
async function processShiftClose({ tx, device, doc }: DocumentContext) {
  const close = shiftClosePayloadSchema.parse(doc.payload);
  const fields = {
    status: 'closed',
    closeDocId: doc.id,
    closedBy: close.closedBy,
    closedAt: new Date(doc.deviceTime),
    closing: close,
    shortageTreatment: close.shortageTreatment,
    forced: close.forced,
  };
  const [closed] = await tx
    .insert(shifts)
    .values({
      tenantId: device.tenantId,
      id: close.shiftId,
      branchId: device.branchId,
      deviceId: device.deviceId,
      number: close.shiftNumber,
      ...fields,
    })
    .onConflictDoUpdate({
      target: [shifts.tenantId, shifts.id],
      set: fields,
      where: isNull(shifts.closeDocId),
    })
    .returning({ closeDocId: shifts.closeDocId });
  // Only the close that closed the shift moves money; a second close of the same shift is stored
  // in the inbox and posts nothing.
  if (closed?.closeDocId === doc.id) {
    await postShiftClose(
      tx,
      { tenantId: device.tenantId, branchId: device.branchId, docId: doc.id, businessDate: doc.businessDate },
      close,
    );
  }
  return { flags: offlineApproval([close.approval]) };
}

/** cash_movement: pay-in, pay-out, expense or drop, linked to its shift when that has arrived. */
async function processCashMovement({ tx, device, doc }: DocumentContext) {
  const m = cashMovementPayloadSchema.parse(doc.payload);
  const [inserted] = await tx
    .insert(cashMovements)
    .values({
      tenantId: device.tenantId,
      id: doc.id,
      branchId: device.branchId,
      deviceId: device.deviceId,
      number: doc.number,
      businessDate: doc.businessDate,
      shiftId: m.shiftId,
      shiftLinked: await shiftOpened(tx, m.shiftId),
      kind: m.kind,
      currency: m.currency,
      amountMinor: m.amountMinor,
      baseCurrency: m.baseCurrency,
      rate: m.rate,
      baseAmountMinor: m.baseAmountMinor,
      reason: m.reason,
      expenseAccountCode: m.expenseAccountCode,
      reference: m.reference,
      performedBy: m.performedBy,
      approval: m.approval,
      payload: doc.payload,
    })
    .onConflictDoNothing()
    .returning({ id: cashMovements.id });
  if (inserted) {
    await postCashMovement(
      tx,
      {
        tenantId: device.tenantId,
        branchId: device.branchId,
        docId: doc.id,
        number: doc.number,
        businessDate: doc.businessDate,
      },
      m,
    );
  }
  return { flags: offlineApproval([m.approval]) };
}

/** The processors the server runs (app.ts registers them unless a test passes its own). */
export const DOCUMENT_PROCESSORS: SyncProcessors = {
  sale: processSale,
  shift_open: processShiftOpen,
  shift_close: processShiftClose,
  cash_movement: processCashMovement,
};
