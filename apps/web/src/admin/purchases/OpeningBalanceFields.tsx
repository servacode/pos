import { useEffect, useState } from 'react';
import { rateText, type PurchaseCurrencyCode, type SupplierOpeningBalanceInput } from '@serva/core';
import { SegmentedControl, TextField } from '@serva/ui';
import { useUsdRate } from '../../lib/useUsdRate';
import { CurrencyTerms } from './CurrencyTerms';
import { moneyOf } from './api';
import { paymentProblem } from './supplierRules';

/** What the owner typed for a supplier's opening balance («رصيد افتتاحي», round 47) */
export interface OpeningState {
  kind: 'debt' | 'credit';
  amount: string;
  currency: PurchaseCurrencyCode;
  rate: string;
}

export const emptyOpening = (): OpeningState => ({ kind: 'debt', amount: '', currency: 'SYP', rate: '' });

/** What is wrong with the typed opening amount (null when empty or right) */
export function openingProblem(o: OpeningState): string | null {
  return o.amount.trim() === '' ? null : paymentProblem(o.amount, moneyOf(o.amount));
}

/** Whether the typed rate of a dollar balance is usable (pounds are always) */
export const openingRateOk = (o: OpeningState): boolean =>
  o.currency !== 'USD' || (/^\d{1,7}(\.\d{1,4})?$/.test(rateText(o.rate)) && Number(rateText(o.rate)) > 0);

/** The request the typed state makes, or null while there is no amount (nothing to record) */
export function openingInput(o: OpeningState, id: string): Omit<SupplierOpeningBalanceInput, 'date'> | null {
  const minor = moneyOf(o.amount);
  if (!minor || minor <= 0 || openingProblem(o) || !openingRateOk(o)) return null;
  return {
    id,
    kind: o.kind,
    amountMinor: minor,
    ...(o.currency === 'USD' ? { currency: 'USD' as const, rate: rateText(o.rate) } : {}),
  };
}

/**
 * «رصيد افتتاحي»: the debt the store owed a supplier (or the advance it had paid one) before it started on the
 * system. In pounds, or in dollars when the store keeps dollars; recorded against «الأرصدة الافتتاحية».
 */
export function OpeningBalanceFields({
  value,
  onChange,
  base,
  errors,
}: {
  value: OpeningState;
  onChange: (next: OpeningState) => void;
  base: string;
  errors?: Record<string, string>;
}) {
  const known = useUsdRate();
  const storeRate = base === 'SYP' ? known : null;
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (storeRate && !seeded && !value.rate) {
      setSeeded(true);
      onChange({ ...value, rate: storeRate });
    }
  }, [storeRate, seeded, value, onChange]);
  const problem = openingProblem(value);
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink-muted">رصيد افتتاحي</legend>
      <p className="text-sm text-ink-muted">
        ما كان بينكما قبل أن تبدأ على النظام. اتركه فارغاً إن لم يكن بينكما شيء.
      </p>
      <SegmentedControl
        label="نوع الرصيد"
        value={value.kind}
        onValueChange={(kind) => onChange({ ...value, kind })}
        options={[
          { value: 'debt', label: 'عليك له' },
          { value: 'credit', label: 'له عندك دفعة مقدّمة' },
        ]}
      />
      <CurrencyTerms
        label="عملة الرصيد"
        currency={value.currency}
        onCurrency={(currency) => onChange({ ...value, currency })}
        rate={value.rate}
        onRate={(rate) => onChange({ ...value, rate })}
        storeRate={storeRate}
        error={errors?.rate ?? errors?.currency}
      />
      <TextField
        label={value.currency === 'USD' ? 'المبلغ بالدولار' : 'المبلغ بالليرة'}
        inputMode="decimal"
        autoComplete="off"
        dir="ltr"
        inputClassName="num"
        value={value.amount}
        onChange={(e) => onChange({ ...value, amount: e.target.value })}
        error={problem ?? errors?.amountMinor ?? errors?.date}
      />
    </fieldset>
  );
}
