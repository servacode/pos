import type { CurrencyId } from '@serva/core';
import { cn } from './cn';
import { BackIcon } from './icons';
import { Money } from './Money';

export interface BalanceProps {
  /**
   * The balance in integer minor units, signed on the debit side: positive is «عليه» (owes, a debit
   * balance), negative is «له» (is owed, a credit balance).
   */
  minor: number;
  currency: CurrencyId;
  className?: string;
}

/**
 * A balance with no minus sign (tab 14 › الأرصدة دون إشارة سالب): «عليه 5,000 ل.س» or «له 5,000 ل.س»
 * in the text colour, with the word and a direction arrow, never red. Zero shows the amount alone.
 */
export function Balance({ minor, currency, className }: BalanceProps) {
  const side = minor > 0 ? 'عليه' : minor < 0 ? 'له' : null;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap text-ink', className)}>
      {side ? (
        <>
          {/* Out of the account for «عليه», into it for «له»: the same arrow, turned. */}
          <BackIcon size={16} className={cn('text-ink-muted', minor < 0 && 'rotate-180')} />
          <span className="font-semibold">{side}</span>{' '}
        </>
      ) : null}
      <Money minor={minor} currency={currency} signDisplay="never" />
    </span>
  );
}
