import type { CurrencyCode } from '@serva/core/currencies';
import { convert, lineGross } from '@serva/core/money';
import type { Approval, SaleLine } from '@serva/core/contracts/documents';
import type { TradeRate } from '@serva/core/contracts/common';
import type { PricedInvoice } from '@serva/core/pricing';
import {
  discountOverLimit,
  packPrice,
  priceSale,
  rateFor,
  type SaleCartLine,
  type SaleDiscount,
  type SalePricingInput,
} from '@serva/core/sale';
import type { BarcodeHit, CatalogItem } from '../catalog';

/**
 * The cart (12 › قواعد السلة): lines as the cashier built them, priced on every change by the
 * contract's priceSale(), so what the screen shows is exactly what the sale document will carry.
 */

/** A line's own discount as the cashier typed it, or a price typed in the cart (a discount too). */
export type LineAdjustment =
  | { kind: 'discount'; discount: { type: 'percent'; bp: number } | { type: 'amount'; minor: number } }
  /** The new price of one pack, in the invoice currency (12: تعديل السعر في السلة خصم) */
  | { kind: 'price'; priceMinor: number };

export interface CartLine {
  lineNo: number;
  variantId: string;
  productId: string;
  name: string;
  /** «كغ» for a unit sold in fractions; null for pieces */
  unitSymbol: string | null;
  weighed: boolean;
  barcode: string | null;
  packQty: number;
  packName: string | null;
  /** Packs, thousandths */
  qty: number;
  priceCurrency: CurrencyCode;
  /** The catalog price of one pack, in priceCurrency */
  priceMinor: number;
  /** The variant's «السعر الأدنى للمفاصلة» per base unit, in priceCurrency */
  minPriceMinor: number | null;
  taxRateId: string | null;
  taxRateBp: number;
  adjustment: LineAdjustment | null;
  approval: Approval | null;
}

export interface Cart {
  lines: CartLine[];
  nextLineNo: number;
  invoiceDiscount: { type: 'percent'; bp: number } | { type: 'amount'; minor: number } | null;
  invoiceApproval: Approval | null;
}

export const EMPTY_CART: Cart = { lines: [], nextLineNo: 1, invoiceDiscount: null, invoiceApproval: null };

export interface PricingContext {
  currency: CurrencyCode;
  taxInclusive: boolean;
  rates: readonly TradeRate[];
}

/** Adds an item, or one more of it when the same item (same pack) is already a plain line. */
export function addItem(cart: Cart, item: CatalogItem, hit?: BarcodeHit | null, qty = 1000): Cart {
  const packQty = hit?.barcode.packQty ?? 1000;
  const weighed = item.unit?.allowsFraction ?? false;
  const same = cart.lines.find(
    (line) =>
      line.variantId === item.variantId &&
      line.packQty === packQty &&
      line.adjustment === null &&
      !line.weighed,
  );
  if (same && !weighed) {
    return { ...cart, lines: cart.lines.map((l) => (l === same ? { ...l, qty: l.qty + qty } : l)) };
  }
  const line: CartLine = {
    lineNo: cart.nextLineNo,
    variantId: item.variantId,
    productId: item.productId,
    name: hit?.barcode.packName ? `${item.name} · ${hit.barcode.packName}` : item.name,
    unitSymbol: weighed ? (item.unit?.symbol ?? null) : null,
    weighed,
    barcode: hit?.barcode.code ?? null,
    packQty,
    packName: hit?.barcode.packName ?? null,
    qty,
    priceCurrency: item.price.currency,
    priceMinor: hit
      ? packPrice(item.price.priceMinor, packQty, hit.barcode.packPriceMinor)
      : item.price.priceMinor,
    minPriceMinor: item.price.minPriceMinor,
    taxRateId: item.taxRate?.id ?? null,
    taxRateBp: item.taxRate?.rateBp ?? 0,
    adjustment: null,
    approval: null,
  };
  return { ...cart, lines: [...cart.lines, line], nextLineNo: cart.nextLineNo + 1 };
}

export function updateLine(cart: Cart, lineNo: number, patch: Partial<CartLine>): Cart {
  return { ...cart, lines: cart.lines.map((l) => (l.lineNo === lineNo ? { ...l, ...patch } : l)) };
}

export function removeLine(cart: Cart, lineNo: number): Cart {
  return { ...cart, lines: cart.lines.filter((l) => l.lineNo !== lineNo) };
}

/** Puts a removed line back where it was («تراجع»). */
export function restoreLine(cart: Cart, line: CartLine, index: number): Cart {
  const lines = [...cart.lines];
  lines.splice(Math.min(index, lines.length), 0, line);
  return { ...cart, lines };
}

/** A pack's price converted into the invoice currency, as the engine prices it. */
export function unitPriceOf(
  line: Pick<CartLine, 'priceCurrency' | 'priceMinor'>,
  ctx: PricingContext,
): number {
  return convert(
    line.priceMinor,
    line.priceCurrency,
    ctx.currency,
    rateFor(ctx.rates, line.priceCurrency, ctx.currency),
  );
}

function lineDiscount(line: CartLine, ctx: PricingContext): SaleDiscount | null {
  const adj = line.adjustment;
  if (!adj) return null;
  if (adj.kind === 'discount') {
    return { ...adj.discount, source: 'manual', reason: null, approval: line.approval };
  }
  const gross = lineGross(unitPriceOf(line, ctx), line.qty);
  const asked = lineGross(adj.priceMinor, line.qty);
  return {
    type: 'amount',
    minor: Math.max(0, gross - asked),
    source: 'price_override',
    reason: null,
    approval: line.approval,
  };
}

export function pricingInput(cart: Cart, ctx: PricingContext): SalePricingInput {
  const lines: SaleCartLine[] = cart.lines.map((line) => ({
    lineNo: line.lineNo,
    productId: line.productId,
    variantId: line.variantId,
    name: line.name,
    unitName: line.unitSymbol,
    barcode: line.barcode,
    packQty: line.packQty,
    qty: line.qty,
    priceCurrency: line.priceCurrency,
    priceMinor: line.priceMinor,
    taxRateId: line.taxRateId,
    taxRateBp: line.taxRateBp,
    discount: lineDiscount(line, ctx),
  }));
  return {
    currency: ctx.currency,
    taxInclusive: ctx.taxInclusive,
    exchangeRates: ctx.rates,
    lines,
    invoiceDiscount: cart.invoiceDiscount
      ? { ...cart.invoiceDiscount, source: 'manual', reason: null, approval: cart.invoiceApproval }
      : null,
  };
}

export interface PricedCart {
  lines: SaleLine[];
  priced: PricedInvoice;
}

export function priceCart(cart: Cart, ctx: PricingContext): PricedCart {
  return priceSale(pricingInput(cart, ctx));
}

/** Why a line or the invoice needs the manager's code (11 › ما يحتاج موافقة), or null. */
export type ApprovalNeed = 'over_limit' | 'under_min_price';

export interface ApprovalRules {
  maxDiscountBp: number;
  /** sale.discount_over_limit: the signed-in person approves their own discounts */
  overLimitAllowed: boolean;
}

/** The pack's minimum price in the invoice currency, or null when the variant has none. */
export function minPackPrice(line: CartLine, ctx: PricingContext): number | null {
  if (line.minPriceMinor === null) return null;
  const perPack = lineGross(line.minPriceMinor, line.packQty);
  return unitPriceOf({ priceCurrency: line.priceCurrency, priceMinor: perPack }, ctx);
}

export function lineNeed(
  line: CartLine,
  priced: SaleLine['priced'],
  ctx: PricingContext,
  rules: ApprovalRules,
): ApprovalNeed | null {
  if (!line.adjustment || line.approval) return null;
  // A price under the variant's minimum needs the manager whatever the role's limit.
  if (line.adjustment.kind === 'price') {
    const min = minPackPrice(line, ctx);
    if (min !== null && line.adjustment.priceMinor < min) return 'under_min_price';
  }
  if (rules.overLimitAllowed) return null;
  return discountOverLimit(priced.lineDiscountMinor, priced.grossMinor, rules.maxDiscountBp)
    ? 'over_limit'
    : null;
}

export function invoiceNeed(cart: Cart, priced: PricedInvoice, rules: ApprovalRules): ApprovalNeed | null {
  if (!cart.invoiceDiscount || cart.invoiceApproval || rules.overLimitAllowed) return null;
  const base = priced.totals.grossMinor - priced.totals.lineDiscountMinor;
  return discountOverLimit(priced.totals.invoiceDiscountMinor, base, rules.maxDiscountBp)
    ? 'over_limit'
    : null;
}

/** Pieces in the cart for «عدد القطع»: weighed lines count as one each. */
export function pieceCount(cart: Cart): number {
  return cart.lines.reduce(
    (sum, line) => sum + (line.weighed ? 1 : Math.round((line.qty * line.packQty) / 1_000_000)),
    0,
  );
}
