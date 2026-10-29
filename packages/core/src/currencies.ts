/** Currencies supported at launch. Amounts are always stored as integers in the smallest unit. */
export const CURRENCIES = {
  SYP: { code: 'SYP', nameAr: 'ليرة سورية', symbolAr: 'ل.س', decimals: 2 },
  USD: { code: 'USD', nameAr: 'دولار أمريكي', symbolAr: '$', decimals: 2 },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]];
