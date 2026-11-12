import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  cashMovementPayloadSchema,
  customerPayloadSchema,
  giftVoucherPayloadSchema,
  receiptPayloadSchema,
  returnPayloadSchema,
  salePayloadSchema,
  shiftClosePayloadSchema,
  shiftOpenPayloadSchema,
  verifySalePayload,
  type SalePayload,
  type Approval,
} from '@serva/core';
import {
  cashMovements,
  customers,
  journalLines,
  accounts,
  receipts,
  invoiceLines,
  invoicePayments,
  invoices,
  onlineOrders,
  products,
  saleReturnLines,
  saleReturns,
  shifts,
  stockLevels,
  stockMovements,
  tenantSettings,
  variants,
  vouchers,
  type Transaction,
} from '@serva/db';
import type { SyncFlag } from '@serva/sync';
import {
  postCashMovement,
  postGiftVoucher,
  postReceipt,
  postReturn,
  postSale,
  postShiftClose,
} from './posting';
import type { DocumentContext, SyncProcessors } from './sync-push';
import { returnSerials, sellSerials } from './serials';
import { refreshExpiry } from './expiry';
import { inScope, permissionScope } from '../auth/permissions';

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

/**
 * Moves stock for the stocked variants this store knows (services and unknown ids move nothing),
 * `sign` × baseQty per line, once per document and line. Answers whether any level went negative.
 */
async function moveStock(
  tx: Transaction,
  device: DocumentContext['device'],
  doc: DocumentContext['doc'],
  kind: 'sale' | 'return',
  lines: readonly { lineNo: number; variantId: string; baseQty: number }[],
  sign: 1 | -1,
): Promise<boolean> {
  const { tenantId } = device;
  const ids = [...new Set(lines.map((l) => l.variantId))];
  if (ids.length === 0) return false;
  const stocked = new Set(
    (
      await tx
        .select({ id: variants.id })
        .from(variants)
        .innerJoin(
          products,
          and(eq(products.tenantId, variants.tenantId), eq(products.id, variants.productId)),
        )
        .where(and(eq(variants.tenantId, tenantId), inArray(variants.id, ids), eq(products.type, 'stock')))
    ).map((v) => v.id),
  );
  let negative = false;
  for (const line of lines) {
    if (!stocked.has(line.variantId) || line.baseQty === 0) continue;
    const qty = sign * line.baseQty;
    const [moved] = await tx
      .insert(stockMovements)
      .values({
        tenantId,
        branchId: device.branchId,
        variantId: line.variantId,
        qty,
        kind,
        docId: doc.id,
        lineNo: line.lineNo,
        businessDate: doc.businessDate,
      })
      .onConflictDoNothing()
      .returning({ id: stockMovements.id });
    if (!moved) continue;
    const [level] = await tx
      .insert(stockLevels)
      .values({ tenantId, branchId: device.branchId, variantId: line.variantId, qty })
      .onConflictDoUpdate({
        target: [stockLevels.tenantId, stockLevels.branchId, stockLevels.variantId],
        set: { qty: sql`${stockLevels.qty} + excluded.qty` },
      })
      .returning({ qty: stockLevels.qty });
    if (level!.qty < 0) negative = true;
  }
  return negative;
}

/**
 * Controlled drugs on a sale (03 › الصيدليات): sold by someone without the pharmacist's permission
 * (permission_stale: the till checked, but the permission was withdrawn or the till is not to be
 * trusted), or without the prescription, doctor and patient details (controlled_incomplete). The
 * sale is kept and flagged, never refused (08 › قاعدة 8): it was printed and the drug is gone.
 */
async function controlledFlags(
  tx: Transaction,
  device: DocumentContext['device'],
  sale: SalePayload,
): Promise<SyncFlag[]> {
  const ids = [...new Set(sale.lines.map((l) => l.productId))];
  const controlled = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(inArray(products.id, ids), eq(products.controlled, true)))
    .limit(1);
  if (controlled.length === 0) return [];
  const flags: SyncFlag[] = [];
  const scope = await permissionScope(tx, sale.cashierId, 'pharmacy.controlled');
  if (!inScope(scope, device.branchId)) flags.push('permission_stale');
  const rx = sale.prescription;
  if (!rx || !rx.ref || !rx.doctor || !rx.patientName || !rx.patientId) flags.push('controlled_incomplete');
  return flags;
}

/** The shelf of items that carry expiry dates moves with the sale: the batches the till sees follow it. */
async function refreshShelf(tx: Transaction, sale: SalePayload): Promise<void> {
  const ids = [...new Set(sale.lines.map((l) => l.variantId))];
  const dated = await tx
    .select({ id: variants.id })
    .from(variants)
    .where(and(inArray(variants.id, ids), isNotNull(variants.nearestExpiry)));
  await refreshExpiry(
    tx,
    dated.map((v) => v.id),
  );
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
  if (await moveStock(tx, device, doc, 'sale', sale.lines, -1)) flags.push('negative_stock');
  flags.push(...(await controlledFlags(tx, device, sale)));
  flags.push(...(await sellSerials(tx, tenantId, doc.id, doc.businessDate, sale.lines)));

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
  await refreshShelf(tx, sale);

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
  // Vouchers spent (03 › قسيمة الاستبدال): never refused, flagged when unknown or overdrawn
  flags.push(...(await redeemVouchers(tx, tenantId, sale)));
  // Loyalty points (03 › نقاط الولاء): earned on what was not paid with points, spent at their value
  flags.push(...(await applyLoyalty(tx, tenantId, sale)));
  // An online order sold here (26 › حياة الطلب): it leaves the tills and its pieces their hold
  if (sale.onlineOrderId) {
    await tx
      .update(onlineOrders)
      .set({
        status: 'done',
        saleId: doc.id,
        branchId: device.branchId,
        decidedBy: sale.cashierId,
        decidedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(onlineOrders.tenantId, tenantId),
          eq(onlineOrders.id, sale.onlineOrderId),
          eq(onlineOrders.status, 'accepted'),
        ),
      );
  }
  // A credit sale over the customer's limit is accepted and flagged (08 › قاعدة 8)
  if (sale.customerId && sale.payments.some((p) => p.method === 'credit')) {
    if (await overCreditLimit(tx, tenantId, sale.customerId)) flags.push('credit_limit_exceeded');
  }

  return { flags };
}

/**
 * A return (RET): its lines back into stock, and the money out of the drawer or back to the card.
 * Never refused: a return over what is left of its sale line (the sale here, less the returns
 * already stored) is accepted and flagged over_return for the owner to look at; one whose sale has
 * not arrived yet is stored as it came (sync › pending_link), and the integrity check looks again.
 */
async function processReturn({ tx, device, doc }: DocumentContext) {
  const ret = returnPayloadSchema.parse(doc.payload);
  const { tenantId } = device;
  const flags: SyncFlag[] = [...offlineApproval([ret.approval])];

  const sold = await tx
    .select({ lineNo: invoiceLines.lineNo, qty: invoiceLines.qty })
    .from(invoiceLines)
    .where(and(eq(invoiceLines.tenantId, tenantId), eq(invoiceLines.invoiceId, ret.saleId)));
  if (sold.length > 0) {
    const earlier = await tx
      .select({
        saleLineNo: saleReturnLines.saleLineNo,
        qty: sql<number>`sum(${saleReturnLines.qty})::bigint`,
      })
      .from(saleReturnLines)
      .innerJoin(
        saleReturns,
        and(eq(saleReturns.tenantId, saleReturnLines.tenantId), eq(saleReturns.id, saleReturnLines.returnId)),
      )
      .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, ret.saleId)))
      .groupBy(saleReturnLines.saleLineNo);
    const left = new Map(sold.map((l) => [l.lineNo, l.qty]));
    for (const e of earlier) left.set(e.saleLineNo, (left.get(e.saleLineNo) ?? 0) - Number(e.qty));
    if (ret.lines.some((l) => l.qty > (left.get(l.saleLineNo) ?? 0))) flags.push('over_return');
  }

  const [inserted] = await tx
    .insert(saleReturns)
    .values({
      tenantId,
      id: doc.id,
      branchId: device.branchId,
      deviceId: device.deviceId,
      number: doc.number!,
      businessDate: doc.businessDate,
      deviceTime: new Date(doc.deviceTime),
      saleId: ret.saleId,
      saleNumber: ret.saleNumber,
      shiftId: ret.shiftId,
      shiftLinked: await shiftOpened(tx, ret.shiftId),
      cashierId: ret.cashierId,
      currency: ret.currency,
      reason: ret.reason,
      grossExTaxMinor: ret.totals.grossExTaxMinor,
      discountExTaxMinor: ret.totals.discountExTaxMinor,
      taxMinor: ret.totals.taxMinor,
      totalMinor: ret.totals.totalMinor,
      refundMethod: ret.refunds[0]?.method ?? null,
      refundReference: ret.refunds[0]?.reference ?? null,
      approval: ret.approval,
      flags,
      payload: doc.payload,
    })
    .onConflictDoNothing()
    .returning({ id: saleReturns.id });
  if (!inserted) return { flags };

  await tx.insert(saleReturnLines).values(
    ret.lines.map((l) => ({
      tenantId,
      returnId: doc.id,
      lineNo: l.lineNo,
      saleLineNo: l.saleLineNo,
      productId: l.productId,
      variantId: l.variantId,
      name: l.name,
      qty: l.qty,
      baseQty: l.baseQty,
      taxRateId: l.taxRateId,
      grossExTaxMinor: l.refund.grossExTaxMinor,
      discountExTaxMinor: l.refund.discountExTaxMinor,
      taxMinor: l.refund.taxMinor,
      totalMinor: l.refund.totalMinor,
    })),
  );
  await moveStock(tx, device, doc, 'return', ret.lines, 1);
  const [original] = await tx
    .select({ payload: invoices.payload })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, ret.saleId)));
  await returnSerials(
    tx,
    ret.saleId,
    ret.lines,
    (original?.payload as SalePayload | undefined)?.lines ?? null,
  );
  const voucher = ret.refunds.find((r) => r.method === 'voucher');
  if (voucher) {
    await tx
      .insert(vouchers)
      .values({
        tenantId,
        code: doc.number!,
        returnId: doc.id,
        currency: voucher.currency,
        amountMinor: voucher.amountMinor,
      })
      .onConflictDoNothing();
  }
  await postReturn(
    tx,
    {
      tenantId,
      branchId: device.branchId,
      docId: doc.id,
      number: doc.number!,
      businessDate: doc.businessDate,
    },
    ret,
  );
  return { flags };
}

/**
 * A named customer's points move with each sale: the points spent (their payment at the point's
 * value, rounded up) come off, a point per `earnEveryMinor` of the rest goes on. Spending more than
 * they have is accepted and flagged points_overdrawn, never refused.
 */
async function applyLoyalty(tx: Transaction, tenantId: string, sale: SalePayload): Promise<SyncFlag[]> {
  if (!sale.customerId) return [];
  const [settings] = await tx
    .select({ loyalty: tenantSettings.loyalty })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId));
  const loyalty = settings?.loyalty ?? null;
  const paidWithPoints = sale.payments
    .filter((p) => p.method === 'points')
    .reduce((n, p) => n + p.baseAmountMinor, 0);
  if (!loyalty && paidWithPoints === 0) return [];
  const spent = paidWithPoints > 0 && loyalty ? Math.ceil(paidWithPoints / loyalty.pointValueMinor) : 0;
  const earned = loyalty
    ? Math.floor(Math.max(0, sale.totals.totalMinor - paidWithPoints) / loyalty.earnEveryMinor)
    : 0;
  if (spent === 0 && earned === 0) return paidWithPoints > 0 && !loyalty ? ['points_overdrawn'] : [];
  const [row] = await tx
    .update(customers)
    .set({ loyaltyPoints: sql`${customers.loyaltyPoints} + ${earned - spent}` })
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, sale.customerId)))
    .returning({ points: customers.loyaltyPoints });
  // What they had before this sale is what they have now, less what it earned, plus what it spent
  return spent > 0 && (!row || row.points - earned < 0) ? ['points_overdrawn'] : [];
}

/** A sale's voucher payments against the vouchers they name: their redeemed amount grows. */
async function redeemVouchers(tx: Transaction, tenantId: string, sale: SalePayload): Promise<SyncFlag[]> {
  const flags = new Set<SyncFlag>();
  for (const p of sale.payments) {
    if (p.method !== 'voucher' || !p.reference) continue;
    const [row] = await tx
      .update(vouchers)
      .set({ redeemedMinor: sql`${vouchers.redeemedMinor} + ${p.baseAmountMinor}` })
      .where(and(eq(vouchers.tenantId, tenantId), eq(vouchers.code, p.reference)))
      .returning({ amount: vouchers.amountMinor, redeemed: vouchers.redeemedMinor });
    if (!row) flags.add('unknown_voucher');
    else if (row.redeemed > row.amount) flags.add('voucher_overdrawn');
  }
  return [...flags];
}

/** What a customer owes now: their 1200 lines, debit less credit, base currency. */
export async function customerBalance(
  tx: Transaction,
  tenantId: string,
  customerId: string,
): Promise<number> {
  const [row] = await tx
    .select({
      balance: sql<string>`coalesce(sum(${journalLines.debitMinor} - ${journalLines.creditMinor}), 0)::text`,
    })
    .from(journalLines)
    .innerJoin(
      accounts,
      and(eq(accounts.tenantId, journalLines.tenantId), eq(accounts.id, journalLines.accountId)),
    )
    .where(
      and(
        eq(journalLines.tenantId, tenantId),
        eq(accounts.code, '1200'),
        eq(journalLines.partyType, 'customer'),
        eq(journalLines.partyId, customerId),
      ),
    );
  return Number(row?.balance ?? 0);
}

async function overCreditLimit(tx: Transaction, tenantId: string, customerId: string): Promise<boolean> {
  const [customer] = await tx
    .select({ limit: customers.creditLimitMinor })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
  if (customer?.limit === null || customer?.limit === undefined) return false;
  return (await customerBalance(tx, tenantId, customerId)) > customer.limit;
}

/**
 * customer: a customer the till added. Stored under the document's id, once; a phone this store
 * already has is accepted and flagged duplicate_customer for the owner to merge.
 */
async function processCustomer({ tx, device, doc }: DocumentContext) {
  const c = customerPayloadSchema.parse(doc.payload);
  const flags: SyncFlag[] = [];
  if (c.phone) {
    const [same] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, device.tenantId), eq(customers.phone, c.phone)));
    if (same) flags.push('duplicate_customer');
  }
  await tx
    .insert(customers)
    .values({ tenantId: device.tenantId, id: doc.id, name: c.name, phone: c.phone, createdByDoc: doc.id })
    .onConflictDoNothing();
  return { flags };
}

/** receipt (RCV): a customer's payment, into the drawer of its shift or the card's account. */
async function processReceipt({ tx, device, doc }: DocumentContext) {
  const r = receiptPayloadSchema.parse(doc.payload);
  const [inserted] = await tx
    .insert(receipts)
    .values({
      tenantId: device.tenantId,
      id: doc.id,
      branchId: device.branchId,
      deviceId: device.deviceId,
      number: doc.number!,
      businessDate: doc.businessDate,
      deviceTime: new Date(doc.deviceTime),
      customerId: r.customerId,
      shiftId: r.shiftId,
      shiftLinked: await shiftOpened(tx, r.shiftId),
      cashierId: r.cashierId,
      currency: r.currency,
      amountMinor: r.amountMinor,
      method: r.method,
      reference: r.reference,
      payload: doc.payload,
    })
    .onConflictDoNothing()
    .returning({ id: receipts.id });
  if (inserted) {
    await postReceipt(
      tx,
      {
        tenantId: device.tenantId,
        branchId: device.branchId,
        docId: doc.id,
        number: doc.number!,
        businessDate: doc.businessDate,
      },
      r,
    );
  }
  return { flags: [] };
}

/**
 * gift_voucher (GFT, 03 › الألبسة: قسيمة هدية): a voucher sold at the till, its code the document's
 * number, spent later like an exchange voucher. The money goes in, 2310 owes it.
 */
async function processGiftVoucher({ tx, device, doc }: DocumentContext) {
  const g = giftVoucherPayloadSchema.parse(doc.payload);
  const [inserted] = await tx
    .insert(vouchers)
    .values({
      tenantId: device.tenantId,
      code: doc.number!,
      returnId: doc.id,
      kind: 'gift',
      shiftId: g.shiftId,
      method: g.method,
      currency: g.currency,
      amountMinor: g.amountMinor,
    })
    .onConflictDoNothing()
    .returning({ id: vouchers.id });
  if (inserted) {
    await postGiftVoucher(
      tx,
      {
        tenantId: device.tenantId,
        branchId: device.branchId,
        docId: doc.id,
        number: doc.number!,
        businessDate: doc.businessDate,
      },
      g,
    );
  }
  return { flags: [] };
}

/** Sales, returns, payments and movements that named this shift before it arrived are linked to it now. */
async function linkToShift(tx: Transaction, shiftId: string): Promise<void> {
  await tx
    .update(invoices)
    .set({ shiftLinked: true })
    .where(and(eq(invoices.shiftId, shiftId), eq(invoices.shiftLinked, false)));
  await tx
    .update(cashMovements)
    .set({ shiftLinked: true })
    .where(and(eq(cashMovements.shiftId, shiftId), eq(cashMovements.shiftLinked, false)));
  await tx
    .update(saleReturns)
    .set({ shiftLinked: true })
    .where(and(eq(saleReturns.shiftId, shiftId), eq(saleReturns.shiftLinked, false)));
  await tx
    .update(receipts)
    .set({ shiftLinked: true })
    .where(and(eq(receipts.shiftId, shiftId), eq(receipts.shiftLinked, false)));
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
  return: processReturn,
  receipt: processReceipt,
  gift_voucher: processGiftVoucher,
  customer: processCustomer,
  shift_open: processShiftOpen,
  shift_close: processShiftClose,
  cash_movement: processCashMovement,
};
