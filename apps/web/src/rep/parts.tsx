import type { ReactNode } from 'react';
import { BackIcon, IconButton, Money } from '@serva/ui';
import type { CurrencyCode } from '@serva/core/currencies';

/** The little pieces the rep's screens share (kept apart so each screen file stays about its own job) */

/** A figure with its label, side by side on a phone: the customer's page and the day's summary use them */
export function Figure({
  label,
  children,
  tone = 'plain',
}: {
  label: string;
  children: ReactNode;
  tone?: 'plain' | 'danger' | 'success';
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-control border border-line bg-surface px-3 py-2">
      <span className="text-xs text-ink-muted">{label}</span>
      <span
        className={
          tone === 'danger'
            ? 'num text-base font-bold text-danger-ink'
            : tone === 'success'
              ? 'num text-base font-bold text-success-ink'
              : 'num text-base font-bold text-ink'
        }
      >
        {children}
      </span>
    </div>
  );
}

/** A screen of its own inside the home: a back button and a title */
export function ScreenHead({
  title,
  onBack,
  aside,
}: {
  title: string;
  onBack: () => void;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <IconButton label="رجوع" icon={<BackIcon />} onClick={onBack} />
      <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-ink">{title}</h2>
      {aside}
    </div>
  );
}

/** Amounts per currency on one line: «1,500 ل.س · 20 $» */
export function MoneyList({ byCurrency }: { byCurrency: Record<string, number> }) {
  const entries = Object.entries(byCurrency).filter(([, minor]) => minor !== 0);
  if (entries.length === 0) return <Money minor={0} currency={'SYP' as CurrencyCode} />;
  return (
    <>
      {entries.map(([currency, minor], i) => (
        <span key={currency}>
          {i > 0 ? ' · ' : ''}
          <Money minor={minor} currency={currency as CurrencyCode} />
        </span>
      ))}
    </>
  );
}
