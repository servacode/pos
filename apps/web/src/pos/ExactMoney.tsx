import { CURRENCIES, type CurrencyCode } from '@serva/core/currencies';
import { Money, type MoneyProps } from '@serva/ui';

/** The decimals an amount needs to be shown exactly: none for a whole amount, the stored ones for a half unit */
export function exactDecimals(minor: number, currency: string): number | undefined {
  const stored = CURRENCIES[currency as CurrencyCode]?.decimals;
  return stored !== undefined && minor % 10 ** stored !== 0 ? stored : undefined;
}

/** `Money` that shows the fraction only when there is one («712.50», but «713» for a whole 713) */
export function ExactMoney({ minor, currency, decimals, ...rest }: MoneyProps) {
  return (
    <Money
      minor={minor}
      currency={currency}
      decimals={decimals ?? exactDecimals(minor, currency)}
      {...rest}
    />
  );
}
