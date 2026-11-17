import { useEffect, useState } from 'react';
import type { CurrencyCode } from '@serva/core';
import { Alert, Money } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { isoDay } from '../../lib/dates';
import { getTrialBalance } from '../reports/api';

/** The safe of each currency in the books (112001: الخزنة — ليرة سورية) */
const SAFE_CODE: Partial<Record<CurrencyCode, string>> = { SYP: '112001', USD: '112002' };

/**
 * A cash payment from the safe that the safe cannot cover: said before saving. Display only: the
 * payment still goes through, because the cash may be in the owner's pocket and not yet recorded.
 * Nothing shows when the amount fits, when the safe's balance cannot be read, or for another way of paying.
 */
export function SafeWarning({ active, amountMinor }: { active: boolean; amountMinor: number | null }) {
  const me = useMe();
  const currency = me.settings.baseCurrency;
  const code = SAFE_CODE[currency];
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!active || !code) return;
    let alive = true;
    const to = isoDay(Date.now(), me.tenant.timezone);
    getTrialBalance({ from: '2000-01-01', to, branchId: null })
      .then((t) => alive && setBalance(t.rows.find((r) => r.accountCode === code)?.closingMinor ?? 0))
      .catch(() => alive && setBalance(null));
    return () => {
      alive = false;
    };
  }, [active, code, me.tenant.timezone]);
  if (!active || balance === null || !amountMinor || amountMinor <= balance) return null;
  return (
    <Alert tone="warning" title="الخزنة لا تكفي لهذا الدفع">
      في الخزنة <Money minor={balance} currency={currency} className="font-semibold" /> فقط، والدفع{' '}
      <Money minor={amountMinor} currency={currency} className="font-semibold" />: ستصير الخزنة{' '}
      <Money minor={balance - amountMinor} currency={currency} className="font-semibold" />. إن كان في الخزنة
      نقد لم يُسجَّل فأضفه أولاً، أو اختر الدفع من البنك.
    </Alert>
  );
}
