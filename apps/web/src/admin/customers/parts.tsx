import type { ReactNode } from 'react';
import type { CurrencyCode, CustomerListItem } from '@serva/core';
import { Avatar, CheckIcon, cn } from '@serva/ui';
import { Amt, StatusPill } from '../sales/ui';
import './customers.css';

/**
 * The few pieces the Customers pages share beyond what the Sales set already has (Amt, StatusPill,
 * PageTop, Panel, SxTable): a chip that is a checkbox, tab links, the balance in its words, and the
 * empty and loading blocks. Their styles are customers.css.
 */

/** «من عليه دين فقط»: a pill that is a real checkbox */
export function CheckChip({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="sx-chip">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {checked ? <CheckIcon size={16} /> : null}
      {label}
    </label>
  );
}

/** Owes more than the limit set for them: the till still sells, with a warning. */
export const overLimit = (c: Pick<CustomerListItem, 'creditLimitMinor' | 'balanceMinor'>) =>
  c.creditLimitMinor !== null && c.balanceMinor > c.creditLimitMinor;

/**
 * What a customer owes in words and never by colour alone: «له» for what the store owes them, the
 * amount with a filled «فوق الحد» past the limit, the amount in the warning ink when it is owed, a
 * muted dash for nothing.
 */
export function BalanceCell({
  customer,
  currency,
}: {
  customer: Pick<CustomerListItem, 'creditLimitMinor' | 'balanceMinor'>;
  currency: CurrencyCode;
}) {
  const { balanceMinor } = customer;
  if (balanceMinor < 0) {
    return (
      <span className="cx-ok">
        <span className="cx-sub">له </span>
        <Amt minor={balanceMinor} currency={currency} signDisplay="never" />
      </span>
    );
  }
  if (balanceMinor === 0) return <span className="cx-zero sx-n">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      {overLimit(customer) ? <StatusPill kind="danger">فوق الحد</StatusPill> : null}
      <Amt
        minor={balanceMinor}
        currency={currency}
        className={cn('font-semibold', overLimit(customer) ? 'sx-neg' : 'text-warning-ink')}
      />
    </span>
  );
}

/** The customer's name with a round initial; a link when `to` is given */
export function Who({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <span className="cx-who">
      <Avatar name={name} size="sm" />
      <span className="flex min-w-0 flex-col gap-0.5">{children}</span>
    </span>
  );
}

/** An empty list, or one that could not load: an icon, a line, and the next step */
export function Empty({
  icon,
  title,
  children,
  error = false,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  error?: boolean;
}) {
  return (
    <div className="sx-empty" role={error ? 'alert' : undefined}>
      <span className={cn('ic', error && 'err')}>{icon}</span>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

/** «زبونان / 3 زبائن»: a count line over a list */
export function CountLine({ children }: { children: ReactNode }) {
  return <p className="sx-wait">{children}</p>;
}

/** «الجارية / المتأخرة / …»: one choice of a few, as pills that are radio buttons */
export function RadioChips<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="sx-chips">
      {options.map((o) => (
        <label key={o.value} className="sx-chip">
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** «قبل 3 أيام»: how long ago a day was, from today (both YYYY-MM-DD), the long date in the tooltip */
export function Ago({ day, today, long }: { day: string; today: string; long: string }) {
  const n = Math.max(
    0,
    Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000),
  );
  const num = (v: number) => <bdi className="sx-n">{v}</bdi>;
  let text: ReactNode;
  if (n === 0) text = 'اليوم';
  else if (n === 1) text = 'أمس';
  else if (n === 2) text = 'قبل يومين';
  else if (n < 11) text = <>قبل {num(n)} أيام</>;
  else if (n < 30) text = <>قبل {num(n)} يوماً</>;
  else if (n < 60) text = 'قبل شهر';
  else if (n < 335) text = <>قبل {num(Math.round(n / 30))} أشهر</>;
  else if (n < 730) text = 'قبل سنة';
  else text = <>قبل {num(Math.round(n / 365))} سنوات</>;
  return <span title={long}>{text}</span>;
}

/** A column title that sorts: a button with the direction said in words for a reader that does not see the arrow */
export function SortHead({
  label,
  active,
  dir,
  onSort,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onSort: () => void;
}) {
  return (
    <button type="button" className="cx-sorth" data-active={active || undefined} onClick={onSort}>
      {label}
      <span aria-hidden="true" className="ar">
        {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
      </span>
      {active ? (
        <span className="sr-only">{dir === 'asc' ? ' مرتّب تصاعدياً' : ' مرتّب تنازلياً'}</span>
      ) : null}
    </button>
  );
}
