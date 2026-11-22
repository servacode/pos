import {
  INSTALMENT_FEE_NAME,
  INSTALMENT_FEE_PRODUCT_ID,
  INSTALMENT_FEE_VARIANT_ID,
  buildSchedule,
  markupBpFor,
  markupFor,
  minDownPayment,
  type InstalmentFrequency,
  type InstalmentSettings,
} from '@serva/core/installments';
import type { CurrencyCode } from '@serva/core/currencies';
import type { InstalmentPlanInput } from '@serva/core/contracts/installments';
import type { Cart, CartLine } from '../sale/cart';

/** What the cashier typed in the instalment sheet */
export interface PlanTermsInput {
  goodsTotalMinor: number;
  downMinor: number;
  count: number;
  frequency: InstalmentFrequency;
  firstDueDate: string;
  guarantor: { name: string; phone: string; nationalId: string } | null;
  borrower: { nationalId: string; address: string } | null;
}

/** The plan as the sheet confirms it: the document's field, and the three numbers the panel needs */
export interface PlanDraft {
  plan: InstalmentPlanInput;
  /** رسم التقسيط, added to the invoice as one service line */
  markupMinor: number;
  /** What goes on the customer's account */
  financedMinor: number;
  goodsTotalMinor: number;
  /** The down payment is below the store's minimum: a manager's code is needed */
  belowMinimum: boolean;
}

export type PlanResult = { draft: PlanDraft } | { error: string };

/**
 * The plan for these terms, by the store's own rules (packages/core › installments.ts), or the
 * Arabic reason it cannot be made. The same function the server checks the schedule against.
 */
export function planFor(
  input: PlanTermsInput,
  settings: InstalmentSettings,
  id: string,
  notesMode: InstalmentSettings['notesMode'],
): PlanResult {
  const principal = input.goodsTotalMinor - input.downMinor;
  const markupMinor = markupFor(principal, input.count, settings);
  try {
    const built = buildSchedule({
      totalMinor: input.goodsTotalMinor,
      downPaymentMinor: input.downMinor,
      count: input.count,
      frequency: input.frequency,
      firstDueDate: input.firstDueDate,
      markupMinor,
      roundingStepMinor: settings.roundingStepMinor,
    });
    const g = input.guarantor && input.guarantor.name.trim() ? input.guarantor : null;
    const b =
      input.borrower && (input.borrower.nationalId.trim() || input.borrower.address.trim())
        ? input.borrower
        : null;
    if (settings.guarantorOverMinor !== null && built.financedMinor >= settings.guarantorOverMinor && !g) {
      return { error: 'اكتب اسم الكفيل: المبلغ يحتاج كفيلاً.' };
    }
    return {
      draft: {
        markupMinor: built.markupMinor,
        financedMinor: built.financedMinor,
        goodsTotalMinor: input.goodsTotalMinor,
        belowMinimum: input.downMinor < minDownPayment(input.goodsTotalMinor, settings),
        plan: {
          id,
          count: input.count,
          frequency: input.frequency,
          firstDueDate: input.firstDueDate,
          downPaymentMinor: input.downMinor,
          principalMinor: built.principalMinor,
          markupMinor: built.markupMinor,
          financedMinor: built.financedMinor,
          markupBp: markupBpFor(input.count, settings.markupBands),
          guarantor: g
            ? {
                name: g.name.trim(),
                phone: g.phone.trim() || null,
                nationalId: g.nationalId.trim() || null,
              }
            : null,
          borrower: b ? { nationalId: b.nationalId.trim() || null, address: b.address.trim() || null } : null,
          notesMode,
          schedule: built.instalments,
        },
      },
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** The service line «رسم التقسيط» the invoice carries (no discount, no tax, no stock) */
export function feeLine(cart: Cart, markupMinor: number, currency: CurrencyCode): CartLine {
  return {
    lineNo: cart.lines.reduce((max, l) => Math.max(max, l.lineNo), 0) + 1,
    variantId: INSTALMENT_FEE_VARIANT_ID,
    productId: INSTALMENT_FEE_PRODUCT_ID,
    name: INSTALMENT_FEE_NAME,
    unitSymbol: null,
    weighed: false,
    barcode: null,
    packQty: 1000,
    packName: null,
    qty: 1000,
    priceCurrency: currency,
    priceMinor: markupMinor,
    minPriceMinor: null,
    taxRateId: null,
    taxRateBp: 0,
    adjustment: null,
    approval: null,
    isService: true,
    priceTyped: true,
  };
}

/** The counts the sheet offers: the usual ones and the store's own band edges, up to its longest plan */
export function countChoices(settings: InstalmentSettings): number[] {
  const all = new Set([3, 6, 9, 12, ...settings.markupBands.map((b) => b.upToCount)]);
  return [...all].filter((n) => n >= 1 && n <= settings.maxCount).sort((a, b) => a - b);
}
