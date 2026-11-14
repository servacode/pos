import type { Key, ReactNode } from 'react';
import { Button } from './Button';
import { cn } from './cn';
import { HEAD_ROW_HEIGHT, ROW_HEIGHT, useDensity, type Density } from './context';
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

const CELL_PADDING: Record<Density, string> = {
  touch: 'px-4',
  comfortable: 'px-4',
  compact: 'px-3',
  dense: 'px-2',
};

/**
 * The admin list (هوية 4 › DataTable): a card shell, soft column heads, rows of the density's
 * height with a hairline between them, numeric columns aligned to the end, an optional totals row on
 * surface-total, and loading, empty and error states. A row opens through a link or button in its
 * first cell, so keyboards reach it too. Sorting, filters and virtual scrolling for 50,000 rows
 * build on it.
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
  const cellText = density === 'dense' ? 'text-[0.8125rem]' : 'text-sm';

  function cellClass(column: DataColumn<Row>) {
    return cn(
      CELL_PADDING[density],
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
            <span className="grid size-12 place-items-center rounded-card bg-danger-soft text-danger-ink">
              <AlertCircleIcon size={24} />
            </span>
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
            <Skeleton className={cn('h-3.5', column.numeric ? 'ms-auto w-20' : 'w-3/4')} />
          </td>
        ))}
      </tr>
    ));
  } else if (rows.length === 0) {
    body = (
      <tr>
        <td colSpan={columns.length} className="p-3">
          {empty ?? <p className="px-6 py-10 text-center text-ink-muted">لا شيء هنا بعد.</p>}
        </td>
      </tr>
    );
  } else {
    body = rows.map((row) => (
      <tr
        key={rowKey(row)}
        className={cn(
          ROW_HEIGHT[density],
          'border-b border-line transition-colors duration-120 ease-standard last:border-0 hover:bg-surface-muted/60',
        )}
      >
        {columns.map((column, index) => {
          const content = column.cell
            ? column.cell(row)
            : String((row as Record<string, unknown>)[column.key] ?? '');
          // The first column names the row: plain text there is semibold. A cell drawn by the
          // screen keeps its own weights (a name over a muted line, a link).
          const lead = index === 0 && (typeof content === 'string' || typeof content === 'number');
          return (
            <td key={column.key} className={cn(cellClass(column), lead && 'font-semibold')}>
              {content}
            </td>
          );
        })}
      </tr>
    ));
  }

  return (
    <div className={cn('overflow-hidden rounded-card border border-line bg-surface shadow-e1', className)}>
      <div className="overflow-x-auto">
        <table aria-busy={loading || undefined} className={cn('w-full border-collapse text-ink', cellText)}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className={cn(HEAD_ROW_HEIGHT[density], 'border-b border-line bg-surface-muted/60')}>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(cellClass(column), 'text-xs font-semibold whitespace-nowrap text-ink-subtle')}
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
                className={cn(
                  ROW_HEIGHT[density],
                  'border-t border-line-control/50 bg-surface-total font-bold text-ink',
                )}
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
    </div>
  );
}
