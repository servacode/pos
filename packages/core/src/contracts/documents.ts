import { z } from 'zod';
import { convert, roundDiv } from '../money';
import {
  bpSchema,
  currencyCodeSchema,
  exchangeRateSchema,
  isoTimeSchema,
  minorSchema,
  nonNegativeMinorSchema,
  positiveMinorSchema,
  qtySchema,
  uuidSchema,
} from './common';

/**
 * Payloads of the documents a cashier device sends in phase 1 (17 › الإرسال; 15 › عقد المزامنة v1;
 * 08 › أنواع المستندات): `sale` (INV), `shift_open` (SFT), `shift_close` (no number of its own:
 * it carries its shift's) and `cash_movement` (CSH).
 *
 * The envelope (packages/sync › SyncDocumentBody) already carries what every document needs: id,
 * seq, type, number, deviceTime, businessDate, deviceOffsetMs, engineVersion, contractVersion and
 * deps. The branch and the device come from the device token, never from the payload. These
 * payloads carry the rest: the moment's snapshot (names, prices, tax, rates), who did it and who
 * approved it, and the amounts the device computed, so the server can recompute them with the same
 * engine (totals_mismatch) and post the journal entries of tab 10 without looking anything up that
 * could have changed since.
 *
 * Rules for all four:
 * - money is an integer of minor units next to its currency; quantities are thousandths; rates are
 *   { unit, quote, rate } strings, exactly money.ts ExchangeRate;
 * - every field is always present: null when empty, never left out, so the payload hash and the
 *   receipt reprint never depend on how a client fills defaults;
 * - unknown keys are ignored by validation and kept in the stored document (additive changes stay
 *   inside contract v1);
 * - no cost ever: the server computes it (17 › الكلفة لا تصل جهاز الكاشير أبداً);
 * - none of them lists deps: a printed sale must never be refused because its shift document was
 *   (08 › قواعد ثابتة 8), so the shift is referenced by id in the payload only.
 */

/** Payment methods of phase 1 (09 › payments; 27 › الدفع عند الكاشير). Cheques, points and vouchers come later. */
export const PAYMENT_METHODS = ['cash', 'card', 'wallet', 'transfer', 'credit'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Methods that settle the exact amount and never give change (10 › حساب الفاتورة, step 6). */
export const NON_CASH_METHODS: readonly PaymentMethod[] = ['card', 'wallet', 'transfer', 'credit'];

/** Methods whose reference is mandatory: approval code, wallet transaction or transfer number (27). */
export const REFERENCE_METHODS: readonly PaymentMethod[] = ['card', 'wallet', 'transfer'];

/**
 * Who approved something over the role's limit (11 › ما يحتاج موافقة): `pin` is the manager's code
 * typed on the device; `remote` is the owner's or manager's «اسمح» from a phone (phase 2). `offline`
 * is true when the device had no connection at that moment: the server flags approval_offline.
 */
export const APPROVAL_METHODS = ['pin', 'remote'] as const;
export const approvalSchema = z.object({
  userId: uuidSchema,
  method: z.enum(APPROVAL_METHODS),
  at: isoTimeSchema,
  offline: z.boolean(),
});
export type Approval = z.output<typeof approvalSchema>;

/**
 * A discount as the cashier gave it (09 › sale_line_discounts). `manual` is a discount; a price
 * typed over the shelf price in the cart is `price_override`, an amount discount on the line
 * (12 › قواعد السلة: تعديل السعر في السلة خصم). Both count against the role's limit; over it,
 * `approval` says who allowed it. The shape is the pricing engine's Discount plus these fields.
 */
export const DISCOUNT_SOURCES = ['manual', 'price_override'] as const;
const discountMeta = {
  source: z.enum(DISCOUNT_SOURCES),
  reason: z.string().trim().min(1).max(200).nullable(),
  approval: approvalSchema.nullable(),
};
export const documentDiscountSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('percent'), bp: bpSchema, ...discountMeta }),
  z.object({ type: z.literal('amount'), minor: nonNegativeMinorSchema, ...discountMeta }),
]);
export type DocumentDiscount = z.output<typeof documentDiscountSchema>;

/** The engine's result for one line (pricing.ts PricedLine without lineNo), as the device computed it. */
export const pricedLineSchema = z.object({
  grossMinor: nonNegativeMinorSchema,
  lineDiscountMinor: nonNegativeMinorSchema,
  invoiceDiscountShareMinor: nonNegativeMinorSchema,
  netMinor: nonNegativeMinorSchema,
  taxMinor: nonNegativeMinorSchema,
  grossExTaxMinor: nonNegativeMinorSchema,
  discountExTaxMinor: nonNegativeMinorSchema,
  netExTaxMinor: nonNegativeMinorSchema,
  totalMinor: nonNegativeMinorSchema,
});

/** The engine's invoice totals (pricing.ts PricedInvoice.totals). totalMinor is never cash-rounded. */
export const saleTotalsSchema = z.object({
  grossMinor: nonNegativeMinorSchema,
  lineDiscountMinor: nonNegativeMinorSchema,
  invoiceDiscountMinor: nonNegativeMinorSchema,
  discountMinor: nonNegativeMinorSchema,
  netMinor: nonNegativeMinorSchema,
  grossExTaxMinor: nonNegativeMinorSchema,
  discountExTaxMinor: nonNegativeMinorSchema,
  netExTaxMinor: nonNegativeMinorSchema,
  taxMinor: nonNegativeMinorSchema,
  totalMinor: nonNegativeMinorSchema,
});

/**
 * One sale line: the snapshot of the moment (08 › قواعد ثابتة 2) and what the engine made of it.
 *
 * Packs (09 › barcodes: معامل العبوة): a line sells `qty` packs of `packQty` base units each, at
 * `unitPriceMinor` per pack. A box of 12 scanned twice is qty 2000, packQty 12000, and moves
 * `baseQty` = 24000 base units out of stock. A single piece or a weight has packQty 1000.
 *
 * Prices in another currency (10 › التسعير بعملة والبيع بأخرى): `priceCurrency`/`priceMinor` are the
 * catalog price as it was; `unitPriceMinor` is that price in the invoice currency, converted with
 * the sale's rate for the pair (convert(), half away from zero). The engine prices unitPriceMinor.
 */
export const saleLineSchema = z.object({
  /** Fixed line number (17 › حقول إلزامية): unique, ties in the invoice-discount split go to the smaller one */
  lineNo: z.int().min(1),
  productId: uuidSchema,
  variantId: uuidSchema,
  /** Name as shown and printed: product name and the variant's label (المقاس واللون) */
  name: z.string().trim().min(1).max(200),
  /** Unit symbol printed with weights («1.250 كغ × 300»); null for pieces */
  unitName: z.string().trim().min(1).max(20).nullable(),
  /** The code scanned, if the line came from a scan */
  barcode: z.string().min(1).max(64).nullable(),
  /** Base units in one pack, thousandths (1000 = one piece or one kg) */
  packQty: qtySchema,
  /** Packs sold, thousandths (3 pieces = 3000, 0.250 kg = 250) */
  qty: qtySchema,
  /** Stock out in base units: roundDiv(qty × packQty, 1000) */
  baseQty: z.int().nonnegative(),
  priceCurrency: currencyCodeSchema,
  /** Catalog price of one pack in priceCurrency, before any discount */
  priceMinor: nonNegativeMinorSchema,
  /** Price of one pack in the invoice currency: what the engine prices */
  unitPriceMinor: nonNegativeMinorSchema,
  /** The tax rate row (posting picks its account); null with taxRateBp 0 when untaxed */
  taxRateId: uuidSchema.nullable(),
  taxRateBp: bpSchema,
  discount: documentDiscountSchema.nullable(),
  priced: pricedLineSchema,
});
export type SaleLine = z.output<typeof saleLineSchema>;

/**
 * One payment as received (09 › payments). For cash, amountMinor is what the customer handed over
 * in that currency (the tender); the change comes back in `change`. Non-cash methods settle exact
 * amounts. `rate` is the rate this payment was taken at (the dollar's collect rate when the store
 * uses one, 10 › سعر قبض الدولار), null when the payment is in the invoice currency;
 * baseAmountMinor is convert(amountMinor) into the invoice currency with it.
 */
export const salePaymentSchema = z
  .object({
    /** 1, 2, 3… in the order taken; a return points back at one */
    paymentNo: z.int().min(1),
    method: z.enum(PAYMENT_METHODS),
    currency: currencyCodeSchema,
    amountMinor: positiveMinorSchema,
    rate: exchangeRateSchema.nullable(),
    baseAmountMinor: nonNegativeMinorSchema,
    /** Card approval code, wallet transaction number or transfer reference: required for those */
    reference: z.string().trim().min(1).max(64).nullable(),
    cardLast4: z
      .string()
      .regex(/^\d{4}$/)
      .nullable(),
    cardBrand: z.string().trim().min(1).max(20).nullable(),
    /** The provider account (card acquirer, wallet such as Sham Cash): its subaccount under 1140/1150 */
    providerAccountId: uuidSchema.nullable(),
  })
  .superRefine((p, ctx) => {
    if (REFERENCE_METHODS.includes(p.method) && p.reference === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['reference'],
        message: `a ${p.method} payment needs its reference`,
      });
    }
    if (p.method !== 'card' && (p.cardLast4 !== null || p.cardBrand !== null)) {
      ctx.addIssue({ code: 'custom', path: ['cardLast4'], message: 'card details on a non-card payment' });
    }
    if (p.method === 'cash' && (p.reference !== null || p.providerAccountId !== null)) {
      ctx.addIssue({ code: 'custom', path: ['reference'], message: 'cash has no reference or provider' });
    }
  });
export type SalePayment = z.output<typeof salePaymentSchema>;

/** Change handed back, in one currency the cashier chose (10 › الدفع بأكثر من عملة). */
export const saleChangeSchema = z.object({
  currency: currencyCodeSchema,
  amountMinor: positiveMinorSchema,
  rate: exchangeRateSchema.nullable(),
  /** Its value in the invoice currency, by subtraction so the sale balances exactly (see sale.ts) */
  baseAmountMinor: nonNegativeMinorSchema,
});
export type SaleChange = z.output<typeof saleChangeSchema>;

/**
 * Cash rounding at payment (10 › حساب الفاتورة, step 6; pricing.ts roundCashDue): the cash still
 * due after every other payment, in the settlement currency (the change currency), rounded to that
 * currency's step. roundingBaseMinor is the difference in the invoice currency (posted to 6400,
 * a positive value is a gain); it also absorbs the conversion of the cash due when the settlement
 * currency is not the invoice currency. Present whenever the sale has a cash payment.
 */
export const cashRoundingSchema = z
  .object({
    currency: currencyCodeSchema,
    /** The step used (settings.cashRoundingSteps), 0 = no rounding */
    stepMinor: nonNegativeMinorSchema,
    /** Cash due in `currency` before rounding; negative when other tenders already overpay */
    exactMinor: minorSchema,
    dueMinor: minorSchema,
    roundingMinor: minorSchema,
    roundingBaseMinor: minorSchema,
  })
  .refine((r) => r.roundingMinor === r.dueMinor - r.exactMinor, {
    path: ['roundingMinor'],
    message: 'roundingMinor must be dueMinor − exactMinor',
  });
export type SaleCashRounding = z.output<typeof cashRoundingSchema>;

/** Fields that must name a person (the sale's cashier, an approver…): users.id. */
const userId = uuidSchema;

/**
 * `sale` (INV): a completed sale, numbered when it closed (08 › الترقيم: الرقم عند الإغلاق فقط).
 * A sale «بانتظار الدفع» is never sent before it closes (17 › أنواع أضافتها المراجعة).
 *
 * Balance (checked here, so an unbalanced sale is refused as invalid_payload):
 *   Σ payments.baseAmountMinor − change.baseAmountMinor
 *     = totals.totalMinor + tipMinor + cashRounding.roundingBaseMinor
 * Build it with buildSalePayload() (packages/core › sale.ts), which guarantees this.
 */
export const salePayloadSchema = z
  .object({
    /** The shift this sale belongs to: the id of its shift_open document */
    shiftId: uuidSchema,
    /** Who sold and is signed in on the device */
    cashierId: userId,
    /** The seller for commissions (09 › sales.salesperson_id), when it is not the cashier; else null */
    salespersonId: userId.nullable(),
    /** Optional (12 › الزبون); required for a credit payment */
    customerId: uuidSchema.nullable(),
    /** The customer's name as printed, a snapshot */
    customerName: z.string().trim().min(1).max(120).nullable(),
    /** Invoice currency: the store's base currency when the sale was made */
    currency: currencyCodeSchema,
    /** Shelf prices include tax (settings.taxInclusive at the moment of sale) */
    taxInclusive: z.boolean(),
    /**
     * The rates in force when the sale was made (15 › «السعر الحالي»), one per foreign currency, each
     * pairing it with the invoice currency: they convert foreign-priced lines, change in a foreign
     * currency, and the total printed in the second currency.
     */
    exchangeRates: z.array(exchangeRateSchema).max(10),
    lines: z.array(saleLineSchema).min(1).max(1000),
    invoiceDiscount: documentDiscountSchema.nullable(),
    totals: saleTotalsSchema,
    /** Tip for the staff, outside sales (09 › sales; 10: 2550): due on top of the total */
    tipMinor: nonNegativeMinorSchema,
    payments: z.array(salePaymentSchema).max(20),
    change: saleChangeSchema.nullable(),
    cashRounding: cashRoundingSchema.nullable(),
    note: z.string().trim().min(1).max(500).nullable(),
  })
  .superRefine((sale, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const pairsWithInvoice = (rate: { unit: string; quote: string }, other: string) =>
      (rate.unit === other && rate.quote === sale.currency) ||
      (rate.unit === sale.currency && rate.quote === other);
    const foreignOf = (rate: { unit: string; quote: string }) =>
      rate.unit === sale.currency ? rate.quote : rate.unit;
    const checkRate = (
      path: (string | number)[],
      currency: string,
      rate: { unit: string; quote: string } | null,
    ) => {
      if (currency === sale.currency) {
        if (rate !== null) issue(path, 'no rate for an amount in the invoice currency');
      } else if (rate === null || !pairsWithInvoice(rate, currency)) {
        issue(path, `a ${currency}/${sale.currency} rate is required`);
      }
    };

    const rateCurrencies = new Set<string>();
    sale.exchangeRates.forEach((rate, i) => {
      if (rate.unit !== sale.currency && rate.quote !== sale.currency) {
        issue(['exchangeRates', i], 'every rate pairs a currency with the invoice currency');
      }
      const foreign = foreignOf(rate);
      if (rateCurrencies.has(foreign)) issue(['exchangeRates', i], `two rates for ${foreign}`);
      rateCurrencies.add(foreign);
    });

    const lineNos = new Set<number>();
    sale.lines.forEach((line, i) => {
      if (lineNos.has(line.lineNo)) issue(['lines', i, 'lineNo'], 'lineNo must be unique');
      lineNos.add(line.lineNo);
      if (BigInt(line.baseQty) !== roundDiv(BigInt(line.qty) * BigInt(line.packQty), 1000n)) {
        issue(['lines', i, 'baseQty'], 'baseQty must be roundDiv(qty × packQty, 1000)');
      }
      if (line.priceCurrency !== sale.currency && !rateCurrencies.has(line.priceCurrency)) {
        issue(['lines', i, 'priceCurrency'], `no ${line.priceCurrency} rate in exchangeRates`);
      }
      if (line.priceCurrency === sale.currency && line.unitPriceMinor !== line.priceMinor) {
        issue(['lines', i, 'unitPriceMinor'], 'unitPriceMinor must equal priceMinor in the same currency');
      }
      if (line.taxRateId === null && line.taxRateBp !== 0) {
        issue(['lines', i, 'taxRateId'], 'a taxed line names its tax rate');
      }
    });

    const paymentNos = new Set<number>();
    let hasCash = false;
    let nonCashBase = 0n;
    sale.payments.forEach((payment, i) => {
      if (paymentNos.has(payment.paymentNo)) issue(['payments', i, 'paymentNo'], 'paymentNo must be unique');
      paymentNos.add(payment.paymentNo);
      checkRate(['payments', i, 'rate'], payment.currency, payment.rate);
      if (payment.method === 'cash') hasCash = true;
      else nonCashBase += BigInt(payment.baseAmountMinor);
      if (payment.method === 'credit') {
        if (sale.customerId === null) issue(['payments', i, 'method'], 'a credit sale needs its customer');
        if (payment.currency !== sale.currency) {
          issue(['payments', i, 'currency'], 'credit is in the invoice currency');
        }
      }
    });

    if (sale.change !== null) {
      checkRate(['change', 'rate'], sale.change.currency, sale.change.rate);
      if (!hasCash) issue(['change'], 'change is only given for cash');
      if (sale.cashRounding !== null && sale.cashRounding.currency !== sale.change.currency) {
        issue(['change', 'currency'], 'change is given in the settlement currency');
      }
    }
    if (hasCash !== (sale.cashRounding !== null)) {
      issue(['cashRounding'], 'cashRounding is present exactly when there is a cash payment');
    }
    if (nonCashBase > bigSum([sale.totals.totalMinor, sale.tipMinor])) {
      issue(['payments'], 'non-cash payments exceed the amount due');
    }

    const paid =
      bigSum(sale.payments.map((p) => p.baseAmountMinor)) - BigInt(sale.change?.baseAmountMinor ?? 0);
    const due = bigSum([sale.totals.totalMinor, sale.tipMinor, sale.cashRounding?.roundingBaseMinor ?? 0]);
    if (paid !== due) {
      issue(['payments'], `payments minus change (${paid}) must equal total + tip + rounding (${due})`);
    }
  });
export type SalePayload = z.output<typeof salePayloadSchema>;

// ─── Shifts ──────────────────────────────────────────────────────────────────

/** Shift modes (09 › shifts; 12 › فتح الوردية): a drawer per cashier, one device shared without counting, or a handover by count. */
export const SHIFT_MODES = ['per_cashier', 'shared', 'handover'] as const;
export type ShiftMode = (typeof SHIFT_MODES)[number];

/** Notes and coins counted (12 › عدّاد الفئات); null when the cashier typed the total only. */
export const denominationsSchema = z
  .array(z.object({ valueMinor: positiveMinorSchema, count: z.int().nonnegative() }))
  .max(30)
  .nullable();

/** Sums in BigInt: a refinement must never throw on a huge but well-typed value. */
const bigSum = (values: number[]) => values.reduce((acc, v) => acc + BigInt(v), 0n);

const denominationsTotal = (list: { valueMinor: number; count: number }[]) =>
  list.reduce((acc, d) => acc + BigInt(d.valueMinor) * BigInt(d.count), 0n);

/** One drawer counted: one per cash currency (10 › درج لكل عملة). */
export const cashCountSchema = z
  .object({
    currency: currencyCodeSchema,
    amountMinor: nonNegativeMinorSchema,
    denominations: denominationsSchema,
  })
  .refine((c) => c.denominations === null || denominationsTotal(c.denominations) === BigInt(c.amountMinor), {
    path: ['amountMinor'],
    message: 'amountMinor must be the sum of the denominations',
  });
export type CashCount = z.output<typeof cashCountSchema>;

const uniqueCurrencies = (list: { currency: string }[]) =>
  new Set(list.map((c) => c.currency)).size === list.length;

/**
 * `shift_open` (SFT): the shift's id is this document's id; sales, cash movements and the close
 * refer to it as shiftId. The opening count is blind to nothing: it is what the cashier counted.
 */
export const shiftOpenPayloadSchema = z
  .object({
    openedBy: userId,
    mode: z.enum(SHIFT_MODES),
    /** The shift handed over by count (mode handover); else null */
    handoverFromShiftId: uuidSchema.nullable(),
    /** Opening balance per cash currency */
    opening: z.array(cashCountSchema).min(1).max(5),
  })
  .superRefine((open, ctx) => {
    if ((open.mode === 'handover') !== (open.handoverFromShiftId !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['handoverFromShiftId'],
        message: 'handoverFromShiftId is set exactly for a handover',
      });
    }
    if (!uniqueCurrencies(open.opening)) {
      ctx.addIssue({ code: 'custom', path: ['opening'], message: 'one count per currency' });
    }
  });
export type ShiftOpenPayload = z.output<typeof shiftOpenPayloadSchema>;

/** How a shortage is treated (09 › shifts; 10: 6200, or 1250 charged to the cashier with the owner's approval). */
export const SHORTAGE_TREATMENTS = ['loss', 'cashier_receivable'] as const;

/**
 * One drawer at close, with the expected amount by the formula of 10 › مطابقة الصندوق:
 *   expected = opening + cashIn − changeOut − refunds + receipts + payIn + fxIn − payOut − fxOut − drops
 *   difference = counted − expected (negative is a shortage)
 * cashIn is cash tendered in this currency; payOut covers expenses and pay-outs from the drawer;
 * drops are transfers to the safe. Refunds, receipts and fx are zero until those documents exist.
 * The cashier counts blind: the device shows none of the computed fields before the count.
 */
export const shiftCloseCashSchema = z
  .object({
    currency: currencyCodeSchema,
    /** Rate to the base currency for the difference; null for the base currency */
    rate: exchangeRateSchema.nullable(),
    openingMinor: nonNegativeMinorSchema,
    cashInMinor: nonNegativeMinorSchema,
    changeOutMinor: nonNegativeMinorSchema,
    refundsMinor: nonNegativeMinorSchema,
    receiptsMinor: nonNegativeMinorSchema,
    payInMinor: nonNegativeMinorSchema,
    fxInMinor: nonNegativeMinorSchema,
    payOutMinor: nonNegativeMinorSchema,
    fxOutMinor: nonNegativeMinorSchema,
    dropsMinor: nonNegativeMinorSchema,
    expectedMinor: minorSchema,
    countedMinor: nonNegativeMinorSchema,
    denominations: denominationsSchema,
    differenceMinor: minorSchema,
    /** The difference in the base currency (posted to 6200 or 1250) */
    differenceBaseMinor: minorSchema,
  })
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    const expected =
      bigSum([c.openingMinor, c.cashInMinor, c.receiptsMinor, c.payInMinor, c.fxInMinor]) -
      bigSum([c.changeOutMinor, c.refundsMinor, c.payOutMinor, c.fxOutMinor, c.dropsMinor]);
    if (BigInt(c.expectedMinor) !== expected)
      issue('expectedMinor', 'expectedMinor does not follow the formula');
    if (BigInt(c.differenceMinor) !== BigInt(c.countedMinor) - BigInt(c.expectedMinor)) {
      issue('differenceMinor', 'differenceMinor must be counted − expected');
    }
    if (c.denominations !== null && denominationsTotal(c.denominations) !== BigInt(c.countedMinor)) {
      issue('countedMinor', 'countedMinor must be the sum of the denominations');
    }
  });
export type ShiftCloseCash = z.output<typeof shiftCloseCashSchema>;

/**
 * `shift_close` (no number: the Z report carries its shift's SFT number). Sent once the cashier
 * has counted every drawer; a sale «بانتظار الدفع» blocks it on the device (15).
 */
export const shiftClosePayloadSchema = z
  .object({
    shiftId: uuidSchema,
    /** The SFT number of the shift_open document */
    shiftNumber: z.string().regex(/^SFT-\d{3}-\d{3}-\d{7}$/),
    closedBy: userId,
    /** The store's base currency (differenceBaseMinor is in it) */
    baseCurrency: currencyCodeSchema,
    cash: z.array(shiftCloseCashSchema).min(1).max(5),
    shortageTreatment: z.enum(SHORTAGE_TREATMENTS),
    /** Who allowed charging a shortage to the cashier; null otherwise */
    approval: approvalSchema.nullable(),
    /** The Z report by payment method, as printed (12 › إغلاق الوردية: الملخّص حسب طريقة الدفع) */
    summary: z.object({
      saleCount: z.int().nonnegative(),
      byMethod: z
        .array(
          z.object({
            method: z.enum(PAYMENT_METHODS),
            currency: currencyCodeSchema,
            count: z.int().nonnegative(),
            /** Received by this method in this currency, cash net of the change given in it */
            amountMinor: minorSchema,
          }),
        )
        .max(30),
    }),
    /** Closed by the device itself 24 hours after the licence or subscription ended (15) */
    forced: z.boolean(),
  })
  .superRefine((close, ctx) => {
    if (!uniqueCurrencies(close.cash)) {
      ctx.addIssue({ code: 'custom', path: ['cash'], message: 'one drawer per currency' });
    }
    close.cash.forEach((c, i) => {
      const path = ['cash', i, 'differenceBaseMinor'];
      if (c.currency === close.baseCurrency) {
        if (c.rate !== null)
          ctx.addIssue({
            code: 'custom',
            path: ['cash', i, 'rate'],
            message: 'no rate for the base currency',
          });
        if (c.differenceBaseMinor !== c.differenceMinor) {
          ctx.addIssue({ code: 'custom', path, message: 'differenceBaseMinor must equal differenceMinor' });
        }
        return;
      }
      try {
        const base = convert(c.differenceMinor, c.currency, close.baseCurrency, c.rate ?? undefined);
        if (base !== c.differenceBaseMinor) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: 'differenceBaseMinor must be the converted difference',
          });
        }
      } catch (error) {
        ctx.addIssue({ code: 'custom', path: ['cash', i, 'rate'], message: (error as Error).message });
      }
    });
    if (close.shortageTreatment === 'cashier_receivable' && close.approval === null) {
      ctx.addIssue({ code: 'custom', path: ['approval'], message: 'charging the cashier needs the owner' });
    }
  });
export type ShiftClosePayload = z.output<typeof shiftClosePayloadSchema>;

// ─── Cash movements ──────────────────────────────────────────────────────────

/**
 * Drawer movements of a CSH document (11 › حركات الدرج; 08: إيداع، سحب، تحويل للخزنة):
 * - pay_in: cash put into the drawer (float from the safe): 1110 ← 1120;
 * - pay_out: cash taken out of the drawer to the safe or the office: 1120 ← 1110;
 * - expense: paid from the drawer, `expenseAccountCode` says what for (6101–6190): 61xx ← 1110;
 * - safe_drop: «إيداع للخزنة», the drawer is too full: 1120 ← 1110, a «drop» at close.
 * Owner draws (OWN), currency exchange (FXE) and quick supplier receipts are their own documents.
 */
export const CASH_MOVEMENT_KINDS = ['pay_in', 'pay_out', 'expense', 'safe_drop'] as const;
export type CashMovementKind = (typeof CASH_MOVEMENT_KINDS)[number];

export const cashMovementPayloadSchema = z
  .object({
    shiftId: uuidSchema,
    kind: z.enum(CASH_MOVEMENT_KINDS),
    /** The drawer's currency */
    currency: currencyCodeSchema,
    amountMinor: positiveMinorSchema,
    baseCurrency: currencyCodeSchema,
    /** Rate to the base currency; null when the drawer is in the base currency */
    rate: exchangeRateSchema.nullable(),
    baseAmountMinor: nonNegativeMinorSchema,
    /** Always written (11: كل حركة بسبب مكتوب) */
    reason: z.string().trim().min(1).max(200),
    /** For an expense: the account 6101–6190 (10 › دليل الحسابات); null otherwise */
    expenseAccountCode: z
      .string()
      .regex(/^61(0[1-9]|[1-8]\d|90)$/)
      .nullable(),
    /** The supplier's receipt number or similar, optional */
    reference: z.string().trim().min(1).max(64).nullable(),
    performedBy: userId,
    /** The manager's code over the limit (11 › ما يحتاج موافقة) */
    approval: approvalSchema.nullable(),
  })
  .superRefine((m, ctx) => {
    if ((m.kind === 'expense') !== (m.expenseAccountCode !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['expenseAccountCode'],
        message: 'an expense names its account, other movements do not',
      });
    }
    if (m.currency === m.baseCurrency) {
      if (m.rate !== null)
        ctx.addIssue({ code: 'custom', path: ['rate'], message: 'no rate for the base currency' });
      if (m.baseAmountMinor !== m.amountMinor) {
        ctx.addIssue({ code: 'custom', path: ['baseAmountMinor'], message: 'must equal amountMinor' });
      }
      return;
    }
    try {
      if (convert(m.amountMinor, m.currency, m.baseCurrency, m.rate ?? undefined) !== m.baseAmountMinor) {
        ctx.addIssue({ code: 'custom', path: ['baseAmountMinor'], message: 'must be the converted amount' });
      }
    } catch (error) {
      ctx.addIssue({ code: 'custom', path: ['rate'], message: (error as Error).message });
    }
  });
export type CashMovementPayload = z.output<typeof cashMovementPayloadSchema>;

// ─── Validation entry point ──────────────────────────────────────────────────

/** The payload schema of each document type that has one in this contract version. */
export const DOCUMENT_PAYLOAD_SCHEMAS = {
  sale: salePayloadSchema,
  shift_open: shiftOpenPayloadSchema,
  shift_close: shiftClosePayloadSchema,
  cash_movement: cashMovementPayloadSchema,
} as const;
export type PayloadDocType = keyof typeof DOCUMENT_PAYLOAD_SCHEMAS;
export interface DocumentPayloads {
  sale: SalePayload;
  shift_open: ShiftOpenPayload;
  shift_close: ShiftClosePayload;
  cash_movement: CashMovementPayload;
}

/** The push result code of a document whose payload breaks its schema (stored as rejected). */
export const INVALID_PAYLOAD = 'invalid_payload';

export interface PayloadIssue {
  /** Dotted path inside the payload, e.g. "lines.0.qty" */
  path: string;
  message: string;
}

export type PayloadValidation =
  { ok: true; checked: boolean } | { ok: false; code: typeof INVALID_PAYLOAD; issues: PayloadIssue[] };

const MAX_ISSUES = 20;

export function hasPayloadSchema(type: string): type is PayloadDocType {
  return Object.hasOwn(DOCUMENT_PAYLOAD_SCHEMAS, type);
}

/**
 * Checks a document's payload against its type's schema. Types without a schema yet pass with
 * `checked: false` (they are stored as they arrived, as before). The device runs it before saving,
 * the server before processing: a payload that fails is rejected with `invalid_payload` and the
 * first issues, never half-processed.
 */
export function validateDocumentPayload(type: string, payload: unknown): PayloadValidation {
  if (!hasPayloadSchema(type)) return { ok: true, checked: false };
  const result = DOCUMENT_PAYLOAD_SCHEMAS[type].safeParse(payload);
  if (result.success) return { ok: true, checked: true };
  return {
    ok: false,
    code: INVALID_PAYLOAD,
    issues: result.error.issues.slice(0, MAX_ISSUES).map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  };
}
