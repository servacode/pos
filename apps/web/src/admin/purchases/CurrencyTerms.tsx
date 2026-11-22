import { rateText, type PurchaseCurrencyCode } from '@serva/core';
import { Alert, cn, NumberField, SegmentedControl } from '@serva/ui';

/** Whether a typed rate is far from the usual: outside 50 to 500 pounds, or ten times from the store's own */
export function rateLooksOff(typed: string, storeRate: string | null): boolean {
  const now = Number(rateText(typed));
  if (!Number.isFinite(now) || now <= 0) return false;
  const store = Number(storeRate ?? '');
  if (store > 0 && (now > store * 10 || now < store / 10)) return true;
  return now < 50 || now > 500;
}

/**
 * The currency of a purchase invoice or a supplier payment, and the dollar's rate of the day (round 36,
 * decision 11). It shows nothing when the store has no dollar. The rate starts at the store's rate and is
 * editable: what was agreed with the supplier is what counts. A rate far from the usual is asked about,
 * never refused (the same warning the settings page gives).
 */
export function CurrencyTerms({
  label,
  currency,
  onCurrency,
  rate,
  onRate,
  storeRate,
  error,
  className,
}: {
  /** The group's name: «عملة الفاتورة», «عملة الدفعة» */
  label: string;
  currency: PurchaseCurrencyCode;
  onCurrency: (currency: PurchaseCurrencyCode) => void;
  rate: string;
  onRate: (rate: string) => void;
  /** The store's own rate, null when the store has no dollar */
  storeRate: string | null;
  error?: string | undefined;
  className?: string;
}) {
  if (!storeRate && currency === 'SYP') return null;
  const warning = currency === 'USD' && rate && rateLooksOff(rate, storeRate);
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink-muted">{label}</span>
        <SegmentedControl
          label={label}
          value={currency}
          onValueChange={onCurrency}
          options={[
            { value: 'SYP', label: 'ليرة سورية' },
            { value: 'USD', label: 'دولار' },
          ]}
        />
      </div>
      {currency === 'USD' ? (
        <>
          <NumberField
            label="سعر الدولار بالليرة"
            hint={
              storeRate ? `سعر المتجر اليوم ${storeRate}. عدّله إن اتفقت مع المورد على سعر آخر.` : undefined
            }
            decimals={4}
            dir="ltr"
            value={rate}
            onValueChange={onRate}
            error={error}
          />
          {warning ? (
            <Alert tone="warning">هذا السعر بعيد عن المعتاد للدولار بالليرة. تأكد منه قبل أن تسجّل.</Alert>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
