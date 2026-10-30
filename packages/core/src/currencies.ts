export interface CurrencyInfo {
  /**
   * Internal id stored next to every amount. It is not the ISO code: the old and the new Syrian pound share
   * ISO "SYP" (spec 29 § العملات, rule 7). "SYP" is the new pound (since 2026-01-01).
   */
  id: string;
  iso: string;
  nameAr: string;
  nameEn: string;
  symbolAr: string;
  /** Stored decimals: amounts are integers in 10^-decimals units (12.50 $ = 1250). Never changes for data. */
  decimals: number;
  /** Default fraction digits shown on screen and receipts. A display setting only (spec 14 § العملة). */
  displayDecimals: number;
  /**
   * Suggested cash rounding step in minor units when a store turns cash rounding on (10 pounds, a quarter
   * dollar). Applied only to the part paid in cash, at payment (spec 10, step 6). 0 = no rounding.
   */
  cashStepMinor: number;
  /** Offered to stores as a base or enabled currency. The old pound is kept only for history and imports. */
  active: boolean;
  /** Fixed ratio to another currency: 1 unit of `unit` = `rate` units of this currency. */
  fixedRate?: { unit: string; rate: string };
}

/** Currency registry. Amounts are always stored as integers in the smallest unit of their currency. */
export const CURRENCIES = {
  SYP: {
    id: 'SYP',
    iso: 'SYP',
    nameAr: 'ليرة سورية',
    nameEn: 'Syrian pound',
    symbolAr: 'ل.س',
    decimals: 2,
    displayDecimals: 0,
    cashStepMinor: 1000,
    active: true,
  },
  USD: {
    id: 'USD',
    iso: 'USD',
    nameAr: 'دولار أمريكي',
    nameEn: 'US dollar',
    symbolAr: '$',
    decimals: 2,
    displayDecimals: 2,
    cashStepMinor: 25,
    active: true,
  },
  SYP_OLD: {
    id: 'SYP_OLD',
    iso: 'SYP',
    nameAr: 'ليرة سورية قديمة',
    nameEn: 'Syrian pound (old)',
    symbolAr: 'ل.س قديمة',
    decimals: 2,
    displayDecimals: 0,
    cashStepMinor: 0,
    active: false,
    // 1 new pound = 100 old pounds.
    fixedRate: { unit: 'SYP', rate: '100' },
  },
} as const satisfies Record<string, CurrencyInfo>;

/** Any currency an amount can be in, including the old pound of migrated history. */
export type CurrencyId = keyof typeof CURRENCIES;

/** Ids of the currencies a store can pick as base or enable for trading (excludes the old pound). */
export type CurrencyCode = {
  [Id in CurrencyId]: (typeof CURRENCIES)[Id]['active'] extends true ? Id : never;
}[CurrencyId];

export const CURRENCY_IDS = Object.keys(CURRENCIES) as [CurrencyId, ...CurrencyId[]];

export const CURRENCY_CODES = CURRENCY_IDS.filter((id) => CURRENCIES[id].active) as [
  CurrencyCode,
  ...CurrencyCode[],
];

export function isCurrencyId(value: unknown): value is CurrencyId {
  return typeof value === 'string' && Object.hasOwn(CURRENCIES, value);
}

/** Looks a currency up by internal id, throwing RangeError for an unknown id. */
export function getCurrency(id: CurrencyId): CurrencyInfo {
  if (!isCurrencyId(id)) throw new RangeError(`unknown currency ${JSON.stringify(id)}`);
  return CURRENCIES[id];
}
