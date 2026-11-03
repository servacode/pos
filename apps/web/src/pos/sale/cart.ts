import type { CurrencyCode } from '@serva/core/currencies';
import { convert, lineGross } from '@serva/core/money';
import type { Approval, OrderType, SaleLine } from '@serva/core/contracts/documents';
import type { TradeRate } from '@serva/core/contracts/common';
import type { PricedInvoice } from '@serva/core/pricing';
import { bestPromotions, type PromotionRule } from '@serva/core/promotions';
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
  /** The product's category and those above it, for promotions on a category */
  categoryPath?: readonly string[];
  /** The choices picked from the product's modifiers, each with what it adds to one unit */
  choices?: readonly Choice[];
  /** «بدون بصل»: a note for the kitchen, printed with the line */
  note?: string | null;
  /** The product sells each piece by its serial number or IMEI: one per piece before payment */
  tracksSerial?: boolean;
  serials?: readonly string[];
  /** One pack at the shelf price and at the wholesale price (null: none), in priceCurrency */
  retailPriceMinor?: number;
  wholesalePriceMinor?: number | null;
}

/** One choice of a modifier group: «الحجم: كبير» adding its price to one unit */
export interface Choice {
  group: string;
  name: string;
  priceMinor: number;
}

/** What the item, its choices and its note add up to: the line it goes on, if any */
export interface ItemChoice {
  choices: readonly Choice[];
  note: string | null;
}

export interface Cart {
  lines: CartLine[];
  nextLineNo: number;
  /** Restaurants and cafés: how the order is served and its table (03 › المطاعم) */
  service?: { orderType: OrderType; table: string | null };
  /** Quantity of each line already printed for the kitchen, so «للمطبخ» prints only what is new */
  sent?: Record<number, number>;
  /** «سعر الجملة» (03 › الجملة): every line at its wholesale price where it has one */
  priceTier?: 'retail' | 'wholesale';
  invoiceDiscount: { type: 'percent'; bp: number } | { type: 'amount'; minor: number } | null;
  invoiceApproval: Approval | null;
}

export const EMPTY_CART: Cart = { lines: [], nextLineNo: 1, invoiceDiscount: null, invoiceApproval: null };

export interface PricingContext {
  currency: CurrencyCode;
  taxInclusive: boolean;
  rates: readonly TradeRate[];
  /** The promotions running now (promotionActive): each line without a typed discount gets its best one */
  promotions?: readonly PromotionRule[];
}

const choiceKey = (choices: readonly Choice[] | undefined, note: string | null | undefined) =>
  JSON.stringify([(choices ?? []).map((c) => [c.group, c.name]), note ?? null]);

/** The line's name with its choices and note: «قهوة · كبير · سكر زيادة · بدون هيل» */
export function choiceName(name: string, choice: ItemChoice | null | undefined): string {
  if (!choice) return name;
  return [name, ...choice.choices.map((c) => c.name), ...(choice.note ? [choice.note] : [])].join(' · ');
}

/**
 * Adds an item, or one more of it when the same item (same pack, same choices) is already a plain
 * line. Choices add their prices to one unit; a pack adds them for each unit in it.
 */
export function addItem(
  cart: Cart,
  item: CatalogItem,
  hit?: BarcodeHit | null,
  qty = 1000,
  choice?: ItemChoice | null,
): Cart {
  const packQty = hit?.barcode.packQty ?? 1000;
  const weighed = item.unit?.allowsFraction ?? false;
  const key = choiceKey(choice?.choices, choice?.note);
  // A piece with a serial number is a line of its own, so each carries its number
  const same = cart.lines.find(
    (line) =>
      !item.tracksSerial &&
      line.variantId === item.variantId &&
      line.packQty === packQty &&
      line.adjustment === null &&
      !line.weighed &&
      choiceKey(line.choices, line.note) === key,
  );
  if (same && !weighed) {
    return { ...cart, lines: cart.lines.map((l) => (l === same ? { ...l, qty: l.qty + qty } : l)) };
  }
  const extra = (choice?.choices ?? []).reduce((sum, c) => sum + c.priceMinor, 0);
  const extraPerPack = extra === 0 ? 0 : lineGross(extra, packQty);
  const retail =
    (hit ? packPrice(item.price.priceMinor, packQty, hit.barcode.packPriceMinor) : item.price.priceMinor) +
    extraPerPack;
  const wholesaleUnit = item.price.wholesalePriceMinor ?? null;
  const wholesale = wholesaleUnit === null ? null : packPrice(wholesaleUnit, packQty, null) + extraPerPack;
  const line: CartLine = {
    lineNo: cart.nextLineNo,
    variantId: item.variantId,
    productId: item.productId,
    name: choiceName(
      [item.name, hit?.barcode.packName, item.warrantyMonths ? `كفالة ${item.warrantyMonths} شهراً` : null]
        .filter(Boolean)
        .join(' · '),
      choice,
    ),
    unitSymbol: weighed ? (item.unit?.symbol ?? null) : null,
    weighed,
    barcode: hit?.barcode.code ?? null,
    packQty,
    packName: hit?.barcode.packName ?? null,
    qty,
    priceCurrency: item.price.currency,
    priceMinor: cart.priceTier === 'wholesale' && wholesale !== null ? wholesale : retail,
    retailPriceMinor: retail,
    wholesalePriceMinor: wholesale,
    minPriceMinor: item.price.minPriceMinor,
    taxRateId: item.taxRate?.id ?? null,
    taxRateBp: item.taxRate?.rateBp ?? 0,
    adjustment: null,
    approval: null,
    categoryPath: item.categoryPath ?? [],
    ...(choice ? { choices: choice.choices, note: choice.note } : {}),
    ...(item.tracksSerial ? { tracksSerial: true, serials: [] } : {}),
  };
  return { ...cart, lines: [...cart.lines, line], nextLineNo: cart.nextLineNo + 1 };
}

/** Every line at the shelf or the wholesale price; a line without a wholesale price keeps the shelf one. */
export function setPriceTier(cart: Cart, tier: 'retail' | 'wholesale'): Cart {
  return {
    ...cart,
    priceTier: tier,
    lines: cart.lines.map((line) => {
      const retail = line.retailPriceMinor ?? line.priceMinor;
      const wholesale = line.wholesalePriceMinor ?? null;
      return { ...line, priceMinor: tier === 'wholesale' && wholesale !== null ? wholesale : retail };
    }),
  };
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

/** The best promotion running for a line, or null. A discount the cashier typed replaces it. */
export function linePromotion(line: CartLine, ctx: PricingContext) {
  if (line.adjustment || !ctx.promotions?.length) return null;
  const best = bestPromotions(
    [
      {
        lineNo: line.lineNo,
        productId: line.productId,
        categoryPath: line.categoryPath ?? [],
        qty: line.qty,
        unitPriceMinor: unitPriceOf(line, ctx),
        weighed: line.weighed,
      },
    ],
    ctx.promotions,
  );
  return best.get(line.lineNo) ?? null;
}

function lineDiscount(line: CartLine, ctx: PricingContext): SaleDiscount | null {
  const adj = line.adjustment;
  if (!adj) {
    const promo = linePromotion(line, ctx);
    return promo
      ? {
          type: 'amount',
          minor: promo.discountMinor,
          source: 'promotion',
          reason: promo.name,
          approval: null,
        }
      : null;
  }
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
    ...(line.serials?.length ? { serials: line.serials } : {}),
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

/** What the kitchen has not seen yet: each line's quantity beyond what was already sent. */
export function kitchenLines(
  cart: Cart,
): { lineNo: number; name: string; qty: number; unit: string | null }[] {
  return cart.lines.flatMap((line) => {
    const left = line.qty - (cart.sent?.[line.lineNo] ?? 0);
    return left > 0 ? [{ lineNo: line.lineNo, name: line.name, qty: left, unit: line.unitSymbol }] : [];
  });
}

/** Everything on the order is now with the kitchen. */
export function markSent(cart: Cart): Cart {
  return { ...cart, sent: Object.fromEntries(cart.lines.map((l) => [l.lineNo, l.qty])) };
}

/** Pieces of a line, whole: what a line with serial numbers needs one number each for. */
const piecesOf = (line: CartLine) => Math.round((line.qty * line.packQty) / 1_000_000);

/** Lines of serial-numbered products still missing numbers (03 › الإلكترونيات). */
export function missingSerials(cart: Cart): CartLine[] {
  return cart.lines.filter((l) => l.tracksSerial && (l.serials?.length ?? 0) !== piecesOf(l));
}
