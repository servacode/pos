import { useId, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import type { SaleStatus } from '@serva/core';
import {
  AlertCircleIcon,
  Button,
  CheckIcon,
  cn,
  exactDecimals,
  Money,
  RetryIcon,
  UndoIcon,
  type Digits,
  type MoneyProps,
} from '@serva/ui';
import { dayText } from '../../lib/dates';
import { DateField } from '../../lib/DateField';
import {
  addDays,
  PERIOD_KEYS,
  PERIOD_LABELS,
  periodOf,
  periodRange,
  type DayRange,
} from '../reports/periods';
import { SALE_STATUS_TEXT } from './labels';
import './sales.css';

/*
 * The shared pieces of the Sales pages (مبيعات اليوم، الفواتير، الورديات، تقرير الوردية): the money
 * rule, the status badge, the page head, a titled panel, the bar rows, the period chips and the
 * table. Their styles are sales.css, loaded with these lazy pages only.
 */

/** The wrapper every Sales page sits in: the scope of sales.css (and of the sheet's body). */
export function SalesPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('sx', className)}>{children}</div>;
}

/* ───────── money ───────── */

export interface AmtProps extends Omit<MoneyProps, 'decimals'> {
  /** A half unit shows its half («28,372.50»), a whole amount none: the close report's figure */
  exact?: boolean;
  /** `dash`: a zero reads as a muted «—» (a term that did not happen) */
  zero?: 'dash';
  /** The danger colour, for money going out */
  neg?: boolean;
  decimals?: number;
}

/**
 * The one way an amount shows on the Sales pages: the number first with a muted unit after it
 * (ل.س and $ alike), equal-width digits, «—» for a zero where asked. It is the ui Money underneath,
 * so the text stays exactly «1,250 ل.س» / «12.50 $».
 */
export function Amt({
  minor,
  currency,
  exact = false,
  zero,
  neg = false,
  className,
  decimals,
  ...rest
}: AmtProps) {
  if (zero === 'dash' && minor === 0) return <span className="sx-z sx-n">—</span>;
  return (
    <Money
      minor={minor}
      currency={currency}
      decimals={decimals ?? (exact ? exactDecimals(minor, currency) : undefined)}
      className={cn('sx-n', neg && 'sx-neg', className)}
      {...rest}
    />
  );
}

/* ───────── icons not in the shared set ───────── */

const glyph = (path: ReactNode) =>
  function Glyph({ size = 16 }: { size?: number }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="shrink-0"
      >
        {path}
      </svg>
    );
  };

export const ChevRight = glyph(<path d="m9 6 6 6-6 6" />);
export const ChevLeft = glyph(<path d="m15 6-6 6 6 6" />);
export const ChevDown = glyph(<path d="m6 9 6 6 6-6" />);
export const FilterGlyph = glyph(<path d="M3 6h18M6 12h12M10 18h4" />);
export const PartGlyph = glyph(<path d="M20 4v7a4 4 0 0 1-4 4H4M9 10l-5 5 5 5" />);

/* ───────── status badge: quiet when normal, filled with an icon when it is an exception ───────── */

export type BadgeKind = 'ok' | 'danger' | 'warn' | 'open';

export function StatusPill({
  kind,
  icon,
  children,
  className,
}: {
  kind: BadgeKind;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('sx-st', kind === 'ok' ? 'ok' : `fill ${kind}`, className)}>
      {icon}
      {children}
    </span>
  );
}

/** An invoice's status: «مكتملة» quietly with a check, a return filled with its icon */
export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  if (status === 'returned') {
    return (
      <StatusPill kind="danger" icon={<UndoIcon size={16} />}>
        {SALE_STATUS_TEXT[status]}
      </StatusPill>
    );
  }
  if (status === 'partly_returned') {
    return (
      <StatusPill kind="warn" icon={<PartGlyph size={14} />}>
        {SALE_STATUS_TEXT[status]}
      </StatusPill>
    );
  }
  return (
    <StatusPill kind="ok" icon={<CheckIcon size={16} />}>
      {SALE_STATUS_TEXT[status]}
    </StatusPill>
  );
}

/* ───────── page head and panels ───────── */

export function PageTop({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="print:hidden">
      {back}
      <div className="sx-ph">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="sx-ph-acts">{actions}</div> : null}
      </div>
    </div>
  );
}

/** A card with a title: a labelled region of the page. */
export function Panel({
  title,
  aside,
  children,
  className,
  fill = false,
  flush = false,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** The body takes the card's height (a card beside a taller one) */
  fill?: boolean;
  /** The body has no padding of its own (a table or a row of cells fills it) */
  flush?: boolean;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('sx-card', fill && 'sx-col', className)}>
      <div className="sx-card-h">
        <h2 id={id}>{title}</h2>
        {aside ? <span className="sx-aside">{aside}</span> : null}
      </div>
      <div className={cn('sx-card-b', fill && 'fill', flush && 'flush')}>{children}</div>
    </section>
  );
}

/** A share of a whole, as the percentage of the widest figure */
export function share(value: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
}

export function Track({ w, s, color }: { w: number; s?: number; color?: string }) {
  const style = {
    '--w': `${w}%`,
    ...(s !== undefined ? { '--s': `${s}%` } : {}),
    ...(color ? { '--c': color } : {}),
  };
  return (
    <div className="sx-tr" aria-hidden="true">
      <i style={style as CSSProperties} />
    </div>
  );
}

export interface BarItem {
  key: string;
  name: ReactNode;
  small?: ReactNode;
  value: ReactNode;
  extra?: ReactNode;
  /** 0..100 */
  w: number;
  color?: string;
}

/** Rows of a name, a figure and a thin bar under them */
export function BarList({
  items,
  color,
  label,
}: {
  items: readonly BarItem[];
  color?: string;
  label?: string;
}) {
  return (
    <ul className="sx-bars" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className="sx-bar">
          <div className="nm">
            {item.name}
            {item.small ? <small>{item.small}</small> : null}
          </div>
          <div className="v">
            {item.value}
            {item.extra ? <em>{item.extra}</em> : null}
          </div>
          <Track w={item.w} color={item.color ?? color} />
        </li>
      ))}
    </ul>
  );
}

/** One stacked bar of the parts of a whole */
export function Stack({
  parts,
  label,
}: {
  parts: readonly { key: string; w: number; color: string }[];
  label: string;
}) {
  return (
    <div className="sx-stack" role="img" aria-label={label}>
      {parts.map((part) => (
        <i key={part.key} style={{ '--w': `${part.w}%`, '--c': part.color } as CSSProperties} />
      ))}
    </div>
  );
}

export const SERIES = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
];

/* ───────── the day controls ───────── */

/** «اليوم / أمس / هالأسبوع / هالشهر»: a row of pills, one on */
export function PeriodChips({
  name,
  range,
  today,
  onPick,
  scroll = false,
}: {
  name: string;
  range: DayRange;
  today: string;
  onPick: (range: DayRange) => void;
  scroll?: boolean;
}) {
  const chip = periodOf(range, today);
  return (
    <div role="radiogroup" aria-label="المدة" className={cn('sx-chips', scroll && 'scroll')}>
      {PERIOD_KEYS.map((key) => (
        <label key={key} className="sx-chip">
          <input
            type="radio"
            name={name}
            checked={chip === key}
            onChange={() => onPick(periodRange(key, today))}
          />
          {PERIOD_LABELS[key]}
        </label>
      ))}
    </div>
  );
}

/** ‹ 31/10/2026 › : a day, one step back or forward, never past today */
export function DayStepper({
  date,
  today,
  onPick,
}: {
  date: string;
  today: string;
  onPick: (day: string) => void;
}) {
  return (
    <div className="sx-seg">
      <button type="button" aria-label="اليوم السابق" onClick={() => onPick(addDays(date, -1))}>
        <ChevRight />
      </button>
      <div className="sx-mid">
        <DateField label="التاريخ" hideLabel value={date} max={today} required onChange={onPick} />
      </div>
      <button
        type="button"
        aria-label="اليوم التالي"
        disabled={date >= today}
        onClick={() => onPick(addDays(date, 1))}
      >
        <ChevLeft />
      </button>
    </div>
  );
}

/* ───────── the table ───────── */

export interface SxColumn<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Amounts and counts: aligned to the end */
  numeric?: boolean;
  /** The foot row's cell */
  total?: ReactNode;
  /** Hidden under 1280px: the column that can wait */
  hideBelowLg?: boolean;
  /** The first column: the row's name, bold */
  lead?: boolean;
  /** An amount that matters: bold */
  strong?: boolean;
  cellClass?: (row: Row) => string | undefined;
}

export function SxTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  onRetry,
  empty,
  groupOf,
  groupLabel,
  onRowClick,
  bare = false,
}: {
  /** Inside a panel: no card of its own */
  bare?: boolean;
  caption: string;
  columns: readonly SxColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  empty?: ReactNode;
  /** Rows with the same key sit under one day header */
  groupOf?: (row: Row) => string;
  groupLabel?: (key: string, count: number) => ReactNode;
  onRowClick?: (row: Row) => void;
}) {
  const hasTotals = columns.some((c) => c.total !== undefined);
  const cls = (c: SxColumn<Row>, extra?: string) =>
    cn(c.numeric && 'e', c.hideBelowLg && 'sx-hide-lg', extra);
  const counts = new Map<string, number>();
  if (groupOf) for (const row of rows) counts.set(groupOf(row), (counts.get(groupOf(row)) ?? 0) + 1);

  function click(row: Row, event: MouseEvent<HTMLTableRowElement>) {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea, label')) return;
    onRowClick?.(row);
  }

  let body: ReactNode;
  if (error) {
    body = (
      <tr>
        <td colSpan={columns.length} className="msg">
          <div role="alert" className="sx-empty">
            <span className="ic err">
              <AlertCircleIcon size={24} />
            </span>
            <p>{error}</p>
            {onRetry ? (
              <Button variant="secondary" size="sm" icon={<RetryIcon />} onClick={onRetry}>
                حاول مرة أخرى
              </Button>
            ) : null}
          </div>
        </td>
      </tr>
    );
  } else if (loading) {
    body = Array.from({ length: 5 }, (_, index) => (
      <tr key={index} aria-hidden="true" className="sx-tbl-skel">
        {columns.map((c) => (
          <td key={c.key} className={cls(c)}>
            <span />
          </td>
        ))}
      </tr>
    ));
  } else if (rows.length === 0) {
    body = (
      <tr>
        <td colSpan={columns.length} className="msg">
          {empty ?? <p className="sx-empty">لا شيء هنا بعد.</p>}
        </td>
      </tr>
    );
  } else {
    let last: string | null = null;
    body = rows.flatMap((row) => {
      const out: ReactNode[] = [];
      if (groupOf) {
        const group = groupOf(row);
        if (group !== last) {
          last = group;
          out.push(
            <tr key={`g-${group}`} className="day">
              <td colSpan={columns.length}>
                {groupLabel ? groupLabel(group, counts.get(group) ?? 0) : group}
              </td>
            </tr>,
          );
        }
      }
      out.push(
        <tr
          key={rowKey(row)}
          className={cn(onRowClick && 'row')}
          onClick={onRowClick ? (event) => click(row, event) : undefined}
        >
          {columns.map((c) => (
            <td key={c.key} className={cn(cls(c, c.cellClass?.(row)), c.lead && 'lead', c.strong && 'tot')}>
              {c.cell(row)}
            </td>
          ))}
        </tr>,
      );
      return out;
    });
  }

  return (
    <div className={cn('sx-tbl-wrap', !bare && 'sx-card')}>
      <div className="sx-tbl-scroll">
        <table aria-busy={loading || undefined} className="sx-tbl">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cls(c)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{body}</tbody>
          {hasTotals && !loading && !error && rows.length > 0 ? (
            <tfoot>
              <tr>
                {columns.map((c) => (
                  <td key={c.key} className={cls(c)}>
                    {c.total}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

/* ───────── small helpers ───────── */

const WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** «الثلاثاء» of a calendar day (YYYY-MM-DD) */
export function weekdayName(day: string): string {
  return WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()] ?? '';
}

export const DownloadGlyph = glyph(<path d="M12 3v12M7 10l5 5 5-5M4 20h16" />);

/** «1 – 20 تشرين الثاني 2026»: a range of days with what repeats said once */
export function rangeText(from: string, to: string, digits: Digits): string {
  if (from === to) return dayText(to, digits);
  const a = dayText(from, digits).split(' ');
  const b = dayText(to, digits).split(' ');
  if (a[2] !== b[2]) return `${dayText(from, digits)} – ${dayText(to, digits)}`;
  if (a[1] !== b[1]) return `${a[0]} ${a[1]} – ${dayText(to, digits)}`;
  return `${a[0]} – ${dayText(to, digits)}`;
}

/** «فاتورة واحدة / فاتورتان / 5 فواتير / 12 فاتورة» for a count of invoices */
export function invoicesNoun(n: number): string {
  if (n === 1) return 'فاتورة واحدة';
  if (n === 2) return 'فاتورتان';
  const text = n.toLocaleString('en-US');
  return n >= 3 && n <= 10 ? `${text} فواتير` : `${text} فاتورة`;
}
