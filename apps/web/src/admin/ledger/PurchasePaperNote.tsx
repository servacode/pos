import type { CurrencyCode, PartyStatementLine } from '@serva/core';
import { Money, useDigits } from '@serva/ui';
import { dayText } from '../../lib/dates';

/**
 * Round 64: under a supplier invoice on the statement: what the paper says (the day it falls due, the discount, the extra
 * charges), so the statement agrees with the paper and not only with the balance. Shows nothing for any other line.
 */
export function PurchasePaperNote({ line, base }: { line: PartyStatementLine; base: CurrencyCode }) {
  const digits = useDigits();
  const p = line.purchase;
  if (!p || (!p.dueDate && !p.discountMinor && !p.chargesMinor)) return null;
  // A dollar invoice's discount and charges are in dollars: its line carries dollars too
  const currency: CurrencyCode = line.usdCreditMinor ? 'USD' : base;
  return (
    <span className="block text-xs font-normal text-ink-muted">
      {p.dueDate ? <>تستحق {dayText(p.dueDate, digits)}</> : null}
      {p.discountMinor ? (
        <>
          {p.dueDate ? ' · ' : ''}خصم <Money minor={p.discountMinor} currency={currency} />
        </>
      ) : null}
      {p.chargesMinor ? (
        <>
          {p.dueDate || p.discountMinor ? ' · ' : ''}رسوم <Money minor={p.chargesMinor} currency={currency} />
        </>
      ) : null}
    </span>
  );
}
