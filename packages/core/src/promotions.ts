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
 * Each runs between startsAt and endsAt (any end open), on the chosen days of the week (none =
 * every day), and between fromTime and toTime of the store's local clock (both null = all day; a
 * window past midnight, 22:00–02:00, is allowed).
 */

export const PROMOTION_KINDS = ['percent', 'buy_get'] as const;
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
  if (rule.daysOfWeek.length > 0 && !rule.daysOfWeek.includes(weekday)) return false;
  if (rule.fromTime && rule.toTime) {
    const inside =
      rule.fromTime <= rule.toTime
        ? time >= rule.fromTime && time < rule.toTime
        : time >= rule.fromTime || time < rule.toTime;
    if (!inside) return false;
  }
  return true;
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
): Map<number, LinePromotion> {
  const out = new Map<number, LinePromotion>();
  for (const line of lines) {
    let best: LinePromotion | null = null;
    for (const rule of rules) {
      const discountMinor = promotionDiscount(rule, line);
      if (discountMinor > 0 && (!best || discountMinor > best.discountMinor)) {
        best = { promotionId: rule.id, name: rule.name, discountMinor };
      }
    }
    if (best) out.set(line.lineNo, best);
  }
  return out;
}
