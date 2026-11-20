import type { CustomerKind } from './contracts/customers';
import { applyBasisPoints, lineGross } from './money';

/**
 * Automatic promotions (03 › المولات والسوبرماركت: عروض متقدمة; 20 › العروض): the cart gives each
 * line the best promotion that applies to it, as an amount discount with source `promotion` and the
 * promotion's name as its reason. Promotions never stack on one line, and a discount the cashier
 * typed on a line replaces the promotion there. They do not count against the cashier's discount
 * limit: the owner set them.
 *
 *   percent   «خصم 10% على الألبان»: percentBp of the line's gross
 *   buy_get   «اشترِ 2 والثالث مجاناً»: every buyQty + getQty whole packs, getQty are free
 *
 *   tiered    «اشترِ 10 فأكثر: خصم 5%، 50 فأكثر: 8%»: the percent of the highest tier the line's packs reach
 *   free_item «اشترِ 10 من أ، وخذ 2 من ب مجاناً»: for every buyQty packs of the scope in the cart,
 *             freeQty packs of another item come free, as a line at price 0 that names the promotion
 *
 * A promotion may be for certain customers only: customerKinds (a grocery, a supermarket…),
 * priceTiers (retail or wholesale customers), repOnly (the reps' phones only). Left empty, it is for
 * everyone, as every promotion before trade promotions was.
 *
 * Each runs between startsAt and endsAt (any end open), on the chosen days of the week (none =
 * every day), and between fromTime and toTime of the store's local clock (both null = all day; a
 * window past midnight, 22:00–02:00, is allowed).
 */

export const PROMOTION_KINDS = ['percent', 'buy_get', 'tiered', 'free_item'] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

export const PROMOTION_SCOPES = ['all', 'categories', 'products'] as const;
export type PromotionScope = (typeof PROMOTION_SCOPES)[number];

/** What the engine needs of a promotion (the `promotions` pull set row carries it all). */
export interface PromotionRule {
  id: string;
  name: string;
  kind: PromotionKind;
  percentBp: number | null;
  buyQty: number | null;
  getQty: number | null;
  scope: PromotionScope;
  categoryIds: string[];
  productIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  /** 0 = Sunday … 6 = Saturday; empty = every day */
  daysOfWeek: number[];
  /** "HH:MM" of the store's clock */
  fromTime: string | null;
  toTime: string | null;
  archived: boolean;
  /** tiered: the discount by packs bought, any order; the highest minQty reached wins */
  tiers?: PromotionTier[];
  /** free_item: the item that comes free (a variant) and how many packs of it per buyQty bought */
  freeVariantId?: string | null;
  freeQty?: number | null;
  /** Only customers of these kinds (customers.kind); empty or absent: everyone */
  customerKinds?: CustomerKind[];
  /** Only customers on these price lists; empty or absent: everyone */
  priceTiers?: ('retail' | 'wholesale')[];
  /** Only a sale made on a rep's phone */
  repOnly?: boolean;
  /**
   * «كود الخصم»: set, the promotion runs only on a shop order that carries this code (the till
   * leaves it out of the running ones otherwise); the shop's public prices never include it.
   */
  couponCode?: string | null;
}

export interface PromotionTier {
  /** Packs bought (whole), this tier and above */
  minQty: number;
  percentBp: number;
}

/** Who a sale is for, as far as targeting a promotion cares */
export interface PromotionAudience {
  customerKind: string | null;
  priceTier: 'retail' | 'wholesale';
  /** The sale is made on a rep's phone */
  rep: boolean;
}

export interface PromotionLine {
  lineNo: number;
  productId: string;
  /** The product's category and every category above it */
  categoryPath: readonly string[];
  /** Packs, thousandths */
  qty: number;
  /** One pack's price in the invoice currency */
  unitPriceMinor: number;
  weighed: boolean;
}

export interface LinePromotion {
  promotionId: string;
  name: string;
  /** In the invoice currency, never more than the line's gross */
  discountMinor: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The store's local weekday and "HH:MM" at an instant. */
export function localClock(at: Date, timeZone: string): { weekday: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return { weekday: WEEKDAYS[part('weekday')]!, time: `${part('hour')}:${part('minute')}` };
}

/** Whether a promotion runs at this instant. */
export function promotionActive(rule: PromotionRule, at: Date, timeZone: string): boolean {
  if (rule.archived) return false;
  const ms = at.getTime();
  if (rule.startsAt && ms < Date.parse(rule.startsAt)) return false;
  if (rule.endsAt && ms >= Date.parse(rule.endsAt)) return false;
  const { weekday, time } = localClock(at, timeZone);
  // A window past midnight (22:00-02:00) belongs to the day it began: its small hours count for the day before
  const overnight = Boolean(rule.fromTime && rule.toTime && rule.fromTime > rule.toTime);
  const day = overnight && rule.toTime && time < rule.toTime ? (weekday + 6) % 7 : weekday;
  if (rule.daysOfWeek.length > 0 && !rule.daysOfWeek.includes(day)) return false;
  if (rule.fromTime && rule.toTime) {
    const inside =
      rule.fromTime <= rule.toTime
        ? time >= rule.fromTime && time < rule.toTime
        : time >= rule.fromTime || time < rule.toTime;
    if (!inside) return false;
  }
  return true;
}

/**
 * Whether a promotion is meant for this sale's customer and device. A promotion that names nobody
 * (every promotion made before trade promotions) reaches everyone; with no customer known, one that
 * names kinds or a price list does not.
 */
export function promotionReaches(rule: PromotionRule, audience: PromotionAudience | undefined): boolean {
  const kinds: readonly string[] = rule.customerKinds ?? [];
  const lists = rule.priceTiers ?? [];
  if (kinds.length === 0 && lists.length === 0 && !rule.repOnly) return true;
  if (!audience) return false;
  if (rule.repOnly && !audience.rep) return false;
  if (kinds.length > 0 && (audience.customerKind === null || !kinds.includes(audience.customerKind)))
    return false;
  if (lists.length > 0 && !lists.includes(audience.priceTier)) return false;
  return true;
}

/** The percent of the highest tier a quantity (thousandths of a pack) reaches, or 0 */
export function tierPercentBp(tiers: readonly PromotionTier[] | null | undefined, qty: number): number {
  let bp = 0;
  let reached = -1;
  for (const t of tiers ?? []) {
    if (t.minQty >= 1 && qty >= t.minQty * 1000 && t.minQty > reached && t.percentBp > 0) {
      reached = t.minQty;
      bp = Math.min(t.percentBp, 10_000);
    }
  }
  return bp;
}

/** Whether the scope of a promotion reaches a line (products, categories or everything) */
export function promotionCovers(rule: PromotionRule, line: PromotionLine): boolean {
  return applies(rule, line);
}

function applies(rule: PromotionRule, line: PromotionLine): boolean {
  switch (rule.scope) {
    case 'all':
      return true;
    case 'products':
      return rule.productIds.includes(line.productId);
    case 'categories':
      return line.categoryPath.some((id) => rule.categoryIds.includes(id));
    default:
      return false;
  }
}

/** What one promotion takes off one line; 0 when it does not apply. */
export function promotionDiscount(rule: PromotionRule, line: PromotionLine): number {
  if (!applies(rule, line) || line.qty <= 0 || line.unitPriceMinor <= 0) return 0;
  const gross = lineGross(line.unitPriceMinor, line.qty);
  // free_item gives a line, not a discount; the shop and the line pricing leave it to the cart
  if (rule.kind === 'free_item') return 0;
  if (rule.kind === 'tiered') {
    const bp = tierPercentBp(rule.tiers, line.qty);
    return bp > 0 ? Math.min(gross, applyBasisPoints(gross, bp)) : 0;
  }
  if (rule.kind === 'percent') {
    const bp = rule.percentBp ?? 0;
    if (bp <= 0) return 0;
    return Math.min(gross, applyBasisPoints(gross, Math.min(bp, 10_000)));
  }
  const buy = rule.buyQty ?? 0;
  const get = rule.getQty ?? 0;
  if (line.weighed || buy <= 0 || get <= 0) return 0;
  const packs = Math.floor(line.qty / 1000);
  const free = Math.floor(packs / (buy + get)) * get;
  return Math.min(gross, lineGross(line.unitPriceMinor, free * 1000));
}

/**
 * The best promotion of each line among those running (pass the active ones only, see
 * promotionActive). Ties go to the promotion listed first. Lines no promotion reaches are absent.
 */
export function bestPromotions(
  lines: readonly PromotionLine[],
  rules: readonly PromotionRule[],
  audience?: PromotionAudience,
): Map<number, LinePromotion> {
  const out = new Map<number, LinePromotion>();
  const reaching = rules.filter((r) => promotionReaches(r, audience));
  for (const line of lines) {
    let best: LinePromotion | null = null;
    for (const rule of reaching) {
      const discountMinor = promotionDiscount(rule, line);
      if (discountMinor > 0 && (!best || discountMinor > best.discountMinor)) {
        best = { promotionId: rule.id, name: rule.name, discountMinor };
      }
    }
    if (best) out.set(line.lineNo, best);
  }
  return out;
}

/** One free_item promotion's gift for a cart: this many packs (thousandths) of this variant, free */
export interface FreeGrant {
  promotionId: string;
  name: string;
  variantId: string;
  /** Packs, thousandths: always whole packs */
  qty: number;
}

/**
 * The free lines a cart earns (pass the running promotions only). For each free_item promotion that
 * reaches the customer: the whole packs of its scope in the cart (lines at a price above 0, never a
 * weighed one), divided by buyQty and rounded down, times freeQty. Several promotions each give
 * their own line; one that earns nothing is absent.
 */
export function freeGrants(
  lines: readonly PromotionLine[],
  rules: readonly PromotionRule[],
  audience?: PromotionAudience,
): FreeGrant[] {
  const out: FreeGrant[] = [];
  for (const rule of rules) {
    if (rule.kind !== 'free_item' || !rule.freeVariantId || !promotionReaches(rule, audience)) continue;
    const buy = rule.buyQty ?? 0;
    const give = rule.freeQty ?? 0;
    if (buy <= 0 || give <= 0) continue;
    let packs = 0;
    for (const line of lines) {
      if (line.weighed || line.qty <= 0 || line.unitPriceMinor <= 0 || !applies(rule, line)) continue;
      packs += Math.floor(line.qty / 1000);
    }
    const times = Math.floor(packs / buy);
    if (times > 0) {
      out.push({
        promotionId: rule.id,
        name: rule.name,
        variantId: rule.freeVariantId,
        qty: times * give * 1000,
      });
    }
  }
  return out;
}
