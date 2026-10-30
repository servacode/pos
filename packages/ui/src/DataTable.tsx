import type { Key, ReactNode } from 'react';
import { Button } from './Button';
import { cn } from './cn';
import { ROW_HEIGHT, useDensity } from './context';
import { AlertCircleIcon, RetryIcon } from './icons';
import { Skeleton } from './Skeleton';

export interface DataColumn<Row> {
  key: string;
  header: ReactNode;
  /** The cell. Defaults to row[key]. */
  cell?: (row: Row) => ReactNode;
  /**
   * Amounts, quantities, percents: equal-width digits, aligned to the column end (the left in
   * Arabic) so the digits line up (tab 14 › المحاذاة).
   */
  numeric?: boolean;
  /** The totals row's cell for this column. */
  total?: ReactNode;
  className?: string;
}

export interface DataTableProps<Row> {
  /** What the table lists, for screen readers («فواتير اليوم»). */
  caption: string;
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => Key;
  loading?: boolean;
  /** The error text (two sentences: what happened, what to do) with a retry. */
  error?: string;
  onRetry?: () => void;
  /** What shows when there are no rows: usually an <EmptyState>. */
  empty?: ReactNode;
  className?: string;
}

const SKELETON_ROWS = 5;

/**
 * The admin list (tab 14 › الجدول): numeric columns aligned to the end, an optional totals row, and
 * loading, empty and error states. A totals row on surface-total shows when a column has a `total`.
 * A row opens through a link or button in its first cell, so keyboards reach it too. Sorting, filters and virtual scrolling for 50,000 rows build on it.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  onRetry,
  empty,
  className,
}: DataTableProps<Row>) {
  const density = useDensity();
  const hasTotals = columns.some((column) => column.total !== undefined);
  const cellPadding = density === 'dense' ? 'px-2' : 'px-3';
  const cellText = density === 'dense' ? 'text-[0.8125rem]' : 'text-sm';

  function cellClass(column: DataColumn<Row>) {
    return cn(
      cellPadding,
      column.numeric ? 'num text-end whitespace-nowrap' : 'text-start',
      column.className,
    );
  }

  let body: ReactNode;
  if (error) {
    body = (
      <tr>
        <td colSpan={columns.length} className="p-0">
          <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <AlertCircleIcon size={32} className="text-danger-ink" />
            <p className="max-w-md text-ink">{error}</p>
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
    body = Array.from({ length: SKELETON_ROWS }, (_, index) => (
      <tr
        key={index}
        aria-hidden="true"
        className={cn(ROW_HEIGHT[density], 'border-b border-line last:border-0')}
      >
        {columns.map((column) => (
          <td key={column.key} className={cellClass(column)}>
            <Skeleton className={cn('h-4', column.numeric ? 'ms-auto w-20' : 'w-3/4')} />
          </td>
        ))}
      </tr>
    ));
  } else if (rows.length === 0) {
    body = (
      <tr>
        <td colSpan={columns.length} className="p-0">
          {empty ?? <p className="px-6 py-10 text-center text-ink-muted">لا شيء هنا بعد.</p>}
        </td>
      </tr>
    );
  } else {
    body = rows.map((row) => (
      <tr
        key={rowKey(row)}
        className={cn(ROW_HEIGHT[density], 'border-b border-line last:border-0 hover:bg-canvas')}
      >
        {columns.map((column) => (
          <td key={column.key} className={cellClass(column)}>
            {column.cell ? column.cell(row) : String((row as Record<string, unknown>)[column.key] ?? '')}
          </td>
        ))}
      </tr>
    ));
  }

  return (
    <div className={cn('overflow-x-auto rounded-card border border-line bg-surface', className)}>
      <table aria-busy={loading || undefined} className={cn('w-full border-collapse', cellText)}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className={cn(density === 'dense' ? 'h-8' : 'h-11', 'border-b border-line bg-surface-muted')}>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  cellClass(column),
                  'text-[0.8125rem] font-semibold whitespace-nowrap text-ink-muted',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
        {hasTotals && !loading && !error && rows.length > 0 ? (
          <tfoot>
            <tr
              className={cn(ROW_HEIGHT[density], 'border-t border-line-control bg-surface-total font-bold')}
            >
              {columns.map((column) => (
                <td key={column.key} className={cellClass(column)}>
                  {column.total}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
