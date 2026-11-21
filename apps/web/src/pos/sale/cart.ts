import type { CurrencyCode } from '@serva/core/currencies';
import { convert, lineGross } from '@serva/core/money';
import type {
  Approval,
  BatchAllocation,
  OrderType,
  Prescription,
  SaleLine,
} from '@serva/core/contracts/documents';
import type { TradeRate } from '@serva/core/contracts/common';
import type { OrderCouponRule } from '@serva/core/contracts/shop';
import type { PricedInvoice } from '@serva/core/pricing';
import {
  bestPromotions,
  freeGrants,
  promotionCovers,
  promotionReaches,
  type PromotionAudience,
  type PromotionRule,
} from '@serva/core/promotions';
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
  /** A service (alteration fee, rent, maintenance contract): the invoice-level discount skips it */
  isService?: boolean;
  serials?: readonly string[];
  /** Numbers a manager let through though the store never received them, and who (03 › الإلكترونيات) */
  serialOverrides?: readonly string[];
  serialApprovedBy?: string | null;
  /** The product's warranty in months: the receipt prints its end date per serial */
  warrantyMonths?: number | null;
  /** The batch the till picked for the line, nearest expiry first (03 › الصيدليات); metadata only */
  batchNo?: string | null;
  batchExpiry?: string | null;
  /** One pack at the shelf price and at the wholesale price (null: none), in priceCurrency */
  retailPriceMinor?: number;
  wholesalePriceMinor?: number | null;
  /** The customer's contract price was applied to this line (03 › أسعار العقود): the receipt says «سعر العقد» */
  contractPriced?: boolean;
  /** The price the line had before the contract price replaced it (same unit as priceMinor): shown struck through */
  shelfPriceMinor?: number;
  /** The price was typed by hand (a service's fee): no price list, wholesale tier or contract ever re-prices it */
  priceTyped?: boolean;
  /** The average cost of one unit in priceCurrency, when the till knows it («أقل من التكلفة») */
  costMinor?: number | null;
  /**
   * A free line a «اشترِ وخذ مجاناً» promotion earned: price 0, never stored in the cart (it is
   * worked out again from the cart on every change, see freeLinesOf) and named for the receipt.
   */
  free?: { promotionId: string; name: string };
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
  /**
   * The table's order on the server (03 › وضع النادل), when the till works online: its id and, for
   * each line, the quantity the server already has (so «للمطبخ» adds only the difference)
   */
  hall?: {
    orderId: string;
    known: Record<number, number>;
    /** The server's lines behind each cart line, to cancel them there when a sent line is removed here */
    lineIds?: Record<number, string[]>;
    /** This cart is one part of a split bill: the sale charges only these lines, or one equal share */
    part?: { lineIds: string[] } | { equal: { parts: number; index: number } };
  };
  /** A manager let the sale go through though no valid batch covers some lines (03 › الصيدليات); `sig` names what was shown */
  batchApproval?: { sig: string; approval: Approval } | null;
  /** «سعر الجملة» (03 › الجملة): every line at its wholesale price where it has one */
  priceTier?: 'retail' | 'wholesale';
  /** The customer's contract prices were applied (03 › أسعار العقود): the till says «سعر العقد», not «سعر الجملة» */
  contractPriced?: boolean;
  /** An exchange (03 › الملابس): the voucher of the return just saved, offered first at payment */
  voucher?: string;
  /** A cash exchange: what was just handed back in cash for the returned piece (a notice only) */
  exchangeCashBackMinor?: number;
  /** The name a held cart was put aside under, shown once it is brought back */
  resumedName?: string;
  /** An online shop order opened at the till (26 › حياة الطلب): the sale closes it */
  onlineOrder?: {
    id: string;
    number: string;
    customerName: string;
    /** The offer the customer's coupon code opened: it prices this sale's lines like a running promotion */
    couponRule?: OrderCouponRule | null;
  };
  /** A pre-sale order this sale delivers (المندوبون): the sale names it, and the server marks it delivered, in part or whole */
  salesOrder?: { id: string; number: string };
  /** A sale that delivers an alteration ticket (03 › التعديل والتقصير): the ticket turns delivered once it is saved */
  alteration?: { id: string; number: string; version: number };
  /** A sale made from a quotation (03 › الجملة): the quotation turns converted once the sale is saved */
  quotation?: { id: string; number: string; version: number };
  /** A sale that returns a rental (03 › التأجير): the rental closes once the sale of its rent is saved */
  rental?: {
    id: string;
    number: string;
    version: number;
    cashBackMinor?: number;
    /** A manager's code for the cash refund of the deposit, when the cashier cannot refund */
    cashBackApproval?: Approval;
  };
  /** A sale that bills a maintenance contract (03 › عقود الصيانة): the contract is marked billed once it is saved */
  maintenance?: { id: string; number: string; version: number };
  /** A pharmacy sale's prescription (03 › الصيدليات), asked before payment when an item needs it */
  prescription?: Prescription;
  invoiceDiscount: { type: 'percent'; bp: number } | { type: 'amount'; minor: number } | null;
  invoiceApproval: Approval | null;
  /** The customer the cart is for, when one is attached before payment (prefills a held cart's name) */
  customer?: { id: string; name: string };
  /** Set while the cart is held: the name it was put aside under and when (the held carts' list) */
  held?: { name: string; at: number };
  /** The seller picked for this sale (kept with a held cart, restored when it is brought back) */
  sellerId?: string;
}

export const EMPTY_CART: Cart = { lines: [], nextLineNo: 1, invoiceDiscount: null, invoiceApproval: null };

export interface PricingContext {
  currency: CurrencyCode;
  taxInclusive: boolean;
  rates: readonly TradeRate[];
  /** The promotions running now (promotionActive): each line without a typed discount gets its best one */
  promotions?: readonly PromotionRule[];
  /** Who the sale is for: promotions for certain customers, price lists or reps' phones check it */
  audience?: PromotionAudience;
  /** The items by variant, for the free item of a «اشترِ وخذ مجاناً» promotion */
  variants?: ReadonlyMap<string, CatalogItem>;
  /** What each line takes from which batch, first expiry first (sale/batches.ts); a line not in it has none */
  batchPlan?: ReadonlyMap<number, readonly BatchAllocation[]>;
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
  batch?: { batchNo: string | null; expiry: string } | null,
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
      (line.batchNo ?? null) === (batch?.batchNo ?? null) &&
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
  // A pack has its own wholesale price when the owner set one, else the piece's times the pieces
  const packWholesale = hit?.barcode.packWholesaleMinor ?? null;
  const wholesale =
    wholesaleUnit === null && packWholesale === null
      ? null
      : packPrice(wholesaleUnit ?? 0, packQty, packWholesale) + extraPerPack;
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
    ...(typeof item.price.costMinor === 'number' ? { costMinor: item.price.costMinor } : {}),
    minPriceMinor: item.price.minPriceMinor,
    taxRateId: item.taxRate?.id ?? null,
    taxRateBp: item.taxRate?.rateBp ?? 0,
    adjustment: null,
    approval: null,
    categoryPath: item.categoryPath ?? [],
    ...(item.isService ? { isService: true } : {}),
    ...(choice ? { choices: choice.choices, note: choice.note } : {}),
    ...(item.tracksSerial
      ? {
          tracksSerial: true,
          serials: [],
          ...(item.warrantyMonths ? { warrantyMonths: item.warrantyMonths } : {}),
        }
      : {}),
    ...(batch?.batchNo ? { batchNo: batch.batchNo, batchExpiry: batch.expiry } : {}),
  };
  return { ...cart, lines: [...cart.lines, line], nextLineNo: cart.nextLineNo + 1 };
}

/** Every line at the shelf or the wholesale price; a line without a wholesale price keeps the shelf one. */
export function setPriceTier(cart: Cart, tier: 'retail' | 'wholesale'): Cart {
  return {
    ...cart,
    priceTier: tier,
    lines: cart.lines.map((line) => {
      if (line.priceTyped) return line;
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

/** Why a line's price is not the shelf price: the customer's contract, or the wholesale tier (null: it is) */
export function customerPriceKind(line: CartLine): 'contract' | 'wholesale' | null {
  if (line.contractPriced) return 'contract';
  if (
    !line.priceTyped &&
    line.retailPriceMinor !== undefined &&
    line.retailPriceMinor > line.priceMinor &&
    (line.wholesalePriceMinor ?? null) === line.priceMinor
  )
    return 'wholesale';
  return null;
}

/** The shelf price a customer's price replaced, per pack (undefined when the line is at the shelf price) */
export function shelfPriceOf(line: CartLine): number | undefined {
  const kind = customerPriceKind(line);
  if (kind === 'contract') return line.shelfPriceMinor;
  return kind === 'wholesale' ? line.retailPriceMinor : undefined;
}

/** What a line's customer price (contract or wholesale) saved against the shelf price, in the invoice currency (0 when none) */
export function contractSavingMinor(line: CartLine, ctx: PricingContext): number {
  const shelf = shelfPriceOf(line);
  if (shelf === undefined || shelf <= line.priceMinor) return 0;
  const was = lineGross(unitPriceOf({ priceCurrency: line.priceCurrency, priceMinor: shelf }, ctx), line.qty);
  return Math.max(0, was - lineGross(unitPriceOf(line, ctx), line.qty));
}

/**
 * What each customer-priced line (contract or wholesale) of a finished sale saved, by line number, from
 * the sale's own gross (display only): the gross at the shelf price less the gross at the price charged.
 */
export function contractSavingsOf(
  cart: Cart,
  sale: { lines: readonly { lineNo: number; priced: { grossMinor: number } }[] },
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const line of cart.lines) {
    const shelf = shelfPriceOf(line);
    if (shelf === undefined || line.priceMinor <= 0) continue;
    const sold = sale.lines.find((l) => l.lineNo === line.lineNo);
    if (!sold) continue;
    const saving = Math.round((sold.priced.grossMinor * shelf) / line.priceMinor) - sold.priced.grossMinor;
    if (saving > 0) out[line.lineNo] = saving;
  }
  return out;
}

/** The tag each customer-priced line of a cart carries on the receipt, by line number */
export function priceTagsOf(cart: Cart): Record<number, 'contract' | 'wholesale'> {
  const out: Record<number, 'contract' | 'wholesale'> = {};
  for (const line of cart.lines) {
    const kind = customerPriceKind(line);
    if (kind) out[line.lineNo] = kind;
  }
  return out;
}

/** The best promotion running for a line, or null. A discount the cashier typed replaces it. */
/** The offer a shop order's coupon opened, as a promotion running for this sale only */
export function couponPromotion(rule: OrderCouponRule): PromotionRule {
  return {
    ...rule,
    startsAt: null,
    endsAt: null,
    daysOfWeek: [],
    fromTime: null,
    toTime: null,
    archived: false,
  };
}

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
    ctx.audience,
  );
  return best.get(line.lineNo) ?? null;
}

/**
 * «اشترِ 10 وخذ 1 مجاناً» gives the free piece from the 11th: when the line is exactly one group short
 * (10, 21, …) the cart says so, as a hint under the line. Display only: nothing is added by itself.
 */
export function buyGetHint(line: CartLine, ctx: PricingContext): { get: number; name: string } | null {
  if (line.adjustment || line.weighed || line.free || !ctx.promotions?.length) return null;
  const packs = Math.floor(line.qty / 1000);
  const pl = {
    lineNo: line.lineNo,
    productId: line.productId,
    categoryPath: line.categoryPath ?? [],
    qty: line.qty,
    unitPriceMinor: unitPriceOf(line, ctx),
    weighed: line.weighed,
  };
  for (const rule of ctx.promotions) {
    if (rule.kind !== 'buy_get' || !promotionReaches(rule, ctx.audience) || !promotionCovers(rule, pl)) {
      continue;
    }
    const buy = rule.buyQty ?? 0;
    const get = rule.getQty ?? 0;
    if (buy <= 0 || get <= 0 || line.qty % 1000 !== 0) continue;
    if (packs > 0 && packs % (buy + get) === buy) return { get, name: rule.name };
  }
  return null;
}

/** Free lines take line numbers from here up, clear of any line the cashier adds */
export const FREE_LINE_BASE = 1_000_000;

/**
 * The free lines the cart earns now: ordinary lines at price 0 that name their promotion. They are
 * not kept in the cart, so removing the goods that earned them removes them too; the sale carries
 * them like any other line (stock leaves, the cost goes to cost of sales as for any piece).
 */
export function freeLinesOf(cart: Cart, ctx: PricingContext): CartLine[] {
  if (!ctx.promotions?.length || !ctx.variants) return [];
  const grants = freeGrants(
    cart.lines.map((line) => ({
      lineNo: line.lineNo,
      productId: line.productId,
      categoryPath: line.categoryPath ?? [],
      qty: line.qty,
      unitPriceMinor: unitPriceOf(line, ctx),
      weighed: line.weighed,
    })),
    ctx.promotions,
    ctx.audience,
  );
  const out: CartLine[] = [];
  // What the device holds of each piece, in thousandths of a piece, less what the paid lines and the
  // free lines already given will take: a free piece obeys the stock rule of a normal line (the till
  // asks «بيع على كل حال؟» for a normal line, but cannot ask for a gift, so a free piece the device
  // does not hold is not given)
  const taken = new Map<string, number>();
  for (const paid of cart.lines) {
    taken.set(
      paid.variantId,
      (taken.get(paid.variantId) ?? 0) + Math.round((paid.qty * paid.packQty) / 1000),
    );
  }
  grants.forEach((grant, index) => {
    const item = ctx.variants!.get(grant.variantId);
    // A piece sold by serial number cannot be handed out without one: the promotion skips it
    if (!item || item.tracksSerial) return;
    const line = addItem(EMPTY_CART, item, null, grant.qty).lines[0];
    if (!line) return;
    const want = Math.round((line.qty * line.packQty) / 1000);
    if (!item.isService && typeof item.stockQty === 'number') {
      if (item.stockQty - (taken.get(grant.variantId) ?? 0) < want) return;
      taken.set(grant.variantId, (taken.get(grant.variantId) ?? 0) + want);
    }
    out.push({
      ...line,
      lineNo: FREE_LINE_BASE + index,
      priceMinor: 0,
      retailPriceMinor: 0,
      wholesalePriceMinor: null,
      minPriceMinor: null,
      adjustment: null,
      approval: null,
      free: { promotionId: grant.promotionId, name: grant.name },
    });
  });
  return out;
}

function lineDiscount(line: CartLine, ctx: PricingContext): SaleDiscount | null {
  // A free line carries its promotion's name and nothing off: its price is already 0
  if (line.free) {
    return {
      type: 'amount',
      minor: 0,
      source: 'promotion',
      reason: line.free.name,
      approval: null,
      promotionId: line.free.promotionId,
    };
  }
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
          promotionId: promo.promotionId,
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

/** The line's batches as the sale carries them: the allocations, and the first as the older single batch */
function batchesOf(
  batches: readonly BatchAllocation[] | undefined,
):
  | { batches: readonly BatchAllocation[]; batchNo?: string; batchExpiry?: string | null }
  | Record<string, never> {
  if (!batches || batches.length === 0) return {};
  const first = batches[0]!;
  return {
    batches,
    ...(first.batchNo ? { batchNo: first.batchNo, batchExpiry: first.expiry } : {}),
  };
}

export function pricingInput(cart: Cart, ctx: PricingContext): SalePricingInput {
  const lines: SaleCartLine[] = [...cart.lines, ...freeLinesOf(cart, ctx)].map((line) => ({
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
    ...(line.isService ? { noInvoiceDiscount: true } : {}),
    ...(line.serials?.length ? { serials: line.serials } : {}),
    ...(line.serials?.length && line.warrantyMonths ? { warrantyMonths: line.warrantyMonths } : {}),
    ...(line.serialOverrides?.length
      ? { serialOverrides: line.serialOverrides, serialApprovedBy: line.serialApprovedBy ?? null }
      : {}),
    ...(line.batchNo ? { batchNo: line.batchNo, batchExpiry: line.batchExpiry ?? null } : {}),
    ...batchesOf(ctx.batchPlan?.get(line.lineNo)),
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
  // The discount applies to the goods only: a service's fee is not part of what it is a share of
  const base = priced.lines.reduce(
    (sum, l, i) => (cart.lines[i]?.isService ? sum : sum + l.grossMinor - l.lineDiscountMinor),
    0,
  );
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

/** Whether the cart has a device sold with a warranty (the till then asks who the customer is) */
export const hasWarrantyDevice = (cart: Cart): boolean =>
  cart.lines.some((l) => l.tracksSerial && Boolean(l.warrantyMonths));

/**
 * A customer's contract prices (03 › أسعار العقود: a hospital's tender price): each line of a product
 * that has one is priced at it, per pack, in place of the shelf or wholesale price. A line whose price
 * the cashier typed (a service's fee, a manual price), or in another currency than the contract's, is
 * left as it is, and so is a contract price that is not above zero.
 */
export function applyContractPrices(
  cart: Cart,
  prices: readonly { variantId: string; currency: string; priceMinor: number }[],
): Cart {
  if (prices.length === 0) return cart;
  const byVariant = new Map(prices.map((p) => [p.variantId, p]));
  return {
    ...cart,
    lines: cart.lines.map((line) => {
      const contract = byVariant.get(line.variantId);
      if (
        !contract ||
        contract.priceMinor <= 0 ||
        line.priceTyped ||
        contract.currency !== line.priceCurrency ||
        line.adjustment !== null
      ) {
        return line;
      }
      const price = packPrice(contract.priceMinor, line.packQty, null);
      return {
        ...line,
        // The shelf price is the retail one, even when a wholesale tier had already lowered the line
        ...(line.contractPriced
          ? {}
          : price < (line.retailPriceMinor ?? line.priceMinor)
            ? { shelfPriceMinor: line.retailPriceMinor ?? line.priceMinor }
            : {}),
        priceMinor: price,
        retailPriceMinor: price,
        wholesalePriceMinor: price,
        contractPriced: true,
      };
    }),
  };
}
