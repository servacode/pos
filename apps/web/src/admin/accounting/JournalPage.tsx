import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { CurrencyCode } from '@serva/core';
import {
  AlertCircleIcon,
  Alert,
  Badge,
  Button,
  CheckCircleIcon,
  cn,
  DataTable,
  EmptyState,
  Money,
  ReportsIcon,
  RetryIcon,
  ROW_HEIGHT,
  Sheet,
  Skeleton,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import { dayText, isoDay, monthStart } from '../../lib/dates';
import { getJournal } from '../reports/api';
import type { JournalEntry, JournalLine } from '../reports/contracts';
import { sourceLabel } from '../reports/labels';
import { defaultBranch } from '../reports/parts';
import { useReport } from '../reports/useReport';
import { AccountingLayout } from './AccountingLayout';
import { AccountName, PeriodBar } from './parts';

/** Where an entry came from, with a link when the document has a screen. */
function SourceLink({ entry }: { entry: JournalEntry }) {
  const { source } = entry;
  const label = sourceLabel(source.type);
  const number = source.number ? (
    <bdi dir="ltr" className="num">
      {source.number}
    </bdi>
  ) : null;
  if (source.type === 'shift_close') {
    return (
      <Link
        to={`/shifts/${encodeURIComponent(source.id)}`}
        className="font-semibold text-brand-ink underline-offset-4 hover:underline"
      >
        {label} {number}
      </Link>
    );
  }
  return (
    <span>
      {label} {number}
    </span>
  );
}

/** The account of a line, and under it what it was in its own currency and at which rate. */
function LineAccount({ line, base }: { line: JournalLine; base: CurrencyCode }) {
  return (
    <span className="flex flex-col">
      <AccountName code={line.accountCode} name={line.accountName} />
      {line.currency !== base ? (
        <span className="text-xs text-ink-muted">
          <Money minor={line.amountMinor} currency={line.currency} />
          {line.rate ? (
            <>
              {' '}
              بسعر <bdi className="num">{line.rate.rate}</bdi>
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

function lineColumns(base: CurrencyCode): DataColumn<JournalLine>[] {
  return [
    {
      key: 'account',
      header: 'الحساب',
      cell: (line) => <LineAccount line={line} base={base} />,
      total: 'المجموع',
    },
    {
      key: 'debit',
      header: 'مدين',
      numeric: true,
      cell: (line) => (line.debitMinor ? <Money minor={line.debitMinor} currency={base} /> : ''),
    },
    {
      key: 'credit',
      header: 'دائن',
      numeric: true,
      cell: (line) => (line.creditMinor ? <Money minor={line.creditMinor} currency={base} /> : ''),
    },
  ];
}

/** One fact of the entry drawer: a soft label over its value. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

/** The entry drawer (admin/IntegrityWhy › القيود والمستند): its lines, balance and source document. */
function EntrySheet({ entry, onClose }: { entry: JournalEntry | null; onClose: () => void }) {
  const me = useMe();
  const digits = useDigits();
  const base = me.settings.baseCurrency;
  const debit = entry?.lines.reduce((sum, line) => sum + line.debitMinor, 0) ?? 0;
  const credit = entry?.lines.reduce((sum, line) => sum + line.creditMinor, 0) ?? 0;
  const columns = lineColumns(base).map((column) =>
    column.key === 'debit'
      ? { ...column, total: <Money minor={debit} currency={base} /> }
      : column.key === 'credit'
        ? { ...column, total: <Money minor={credit} currency={base} /> }
        : column,
  );

  return (
    <Sheet
      open={entry !== null}
      onOpenChange={(open) => !open && onClose()}
      closeOnOutsideClick
      title={entry ? `القيد ${entry.number}` : ''}
      description={entry ? dayText(entry.date, digits) : undefined}
    >
      {entry ? (
        <>
          <dl className="grid gap-4 rounded-card border border-line bg-surface-muted/50 p-4 sm:grid-cols-2">
            <Fact label="المستند">
              <SourceLink entry={entry} />
            </Fact>
            {entry.memo ? <Fact label="البيان">{entry.memo}</Fact> : null}
          </dl>
          <DataTable
            caption={`سطور القيد ${entry.number}`}
            columns={columns}
            rows={entry.lines}
            rowKey={(line) => `${line.accountCode}-${line.debitMinor}-${line.creditMinor}-${line.currency}`}
          />
          {debit === credit ? (
            <Badge tone="success" className="self-start">
              <CheckCircleIcon size={16} />
              متوازن
            </Badge>
          ) : (
            <Alert tone="error">مدين هذا القيد لا يساوي دائنه. أرسله للدعم مع رقمه.</Alert>
          )}
        </>
      ) : null}
    </Sheet>
  );
}

// The ledger's cells (هوية 4 › DataTable): 16 in from the card's edges, amounts at the end in
// equal-width digits so they line up down the page.
const CELL = 'px-4';
const AMOUNT = 'num w-28 text-end whitespace-nowrap sm:w-44';
const HEAD = 'py-2.5 text-xs font-semibold whitespace-nowrap text-ink-subtle';

/**
 * The general journal (19 › دفتر اليومية العام): each entry a group of rows under its own heading
 * (number, day, document, memo), its lines under it with the debit and the credit in their own
 * columns. A credit line steps in, as a journal is written by hand. The entry's number opens it.
 */
function JournalTable({
  caption,
  entries,
  base,
  loading,
  error,
  onRetry,
  onOpen,
  empty,
}: {
  caption: string;
  entries: readonly JournalEntry[];
  base: CurrencyCode;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (entry: JournalEntry) => void;
  empty: ReactNode;
}) {
  const digits = useDigits();
  const line = ROW_HEIGHT.compact;

  let body: ReactNode;
  if (error) {
    body = (
      <tbody>
        <tr>
          <td colSpan={3} className="p-0">
            <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <span className="grid size-12 place-items-center rounded-card bg-danger-soft text-danger-ink">
                <AlertCircleIcon size={24} />
              </span>
              <p className="max-w-md text-ink">{error}</p>
              <Button variant="secondary" size="sm" icon={<RetryIcon />} onClick={onRetry}>
                حاول مرة أخرى
              </Button>
            </div>
          </td>
        </tr>
      </tbody>
    );
  } else if (loading) {
    body = Array.from({ length: 3 }, (_, group) => (
      <tbody key={group} aria-hidden="true" className="border-b border-line last:border-0">
        <tr className="bg-surface-muted/40">
          <td colSpan={3} className={cn(CELL, 'py-3')}>
            <Skeleton className="h-3.5 w-2/5" />
          </td>
        </tr>
        {Array.from({ length: 2 }, (_, index) => (
          <tr key={index} className={line}>
            <td className={CELL}>
              <Skeleton className={cn('h-3.5 w-1/2', index === 1 && 'ms-8')} />
            </td>
            <td className={CELL}>{index === 0 ? <Skeleton className="ms-auto h-3.5 w-20" /> : null}</td>
            <td className={CELL}>{index === 1 ? <Skeleton className="ms-auto h-3.5 w-20" /> : null}</td>
          </tr>
        ))}
      </tbody>
    ));
  } else if (entries.length === 0) {
    body = (
      <tbody>
        <tr>
          <td colSpan={3} className="p-3">
            {empty}
          </td>
        </tr>
      </tbody>
    );
  } else {
    body = entries.map((entry) => (
      <tbody key={entry.id} className="border-b border-line last:border-0">
        <tr className="border-b border-line/60 bg-surface-muted/40">
          <th scope="rowgroup" colSpan={3} className={cn(CELL, 'py-1.5 text-start font-normal')}>
            <span className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
              <button
                type="button"
                onClick={() => onOpen(entry)}
                className="inline-flex min-h-8 items-center rounded-sm font-semibold text-brand-ink underline-offset-4 hover:underline pointer-coarse:min-h-12"
              >
                <bdi dir="ltr" className="num">
                  {entry.number}
                </bdi>
              </button>
              <span className="num text-ink-muted">{dayText(entry.date, digits)}</span>
              <span className="text-ink-muted">
                <SourceLink entry={entry} />
              </span>
              {entry.memo ? <span className="min-w-0 text-ink-subtle">{entry.memo}</span> : null}
            </span>
          </th>
        </tr>
        {entry.lines.map((item, index) => {
          const credit = item.creditMinor > 0 && item.debitMinor === 0;
          return (
            <tr
              key={`${item.accountCode}-${index}`}
              className={cn(line, 'transition-colors duration-120 ease-standard hover:bg-surface-muted/60')}
            >
              <td className={cn('py-1.5 pe-4', credit ? 'ps-8 sm:ps-10' : 'ps-4')}>
                <LineAccount line={item} base={base} />
              </td>
              <td className={cn(CELL, AMOUNT)}>
                {item.debitMinor ? <Money minor={item.debitMinor} currency={base} /> : ''}
              </td>
              <td className={cn(CELL, AMOUNT)}>
                {item.creditMinor ? <Money minor={item.creditMinor} currency={base} /> : ''}
              </td>
            </tr>
          );
        })}
      </tbody>
    ));
  }

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-e1">
      <div className="overflow-x-auto">
        <table aria-busy={loading || undefined} className="w-full border-collapse text-sm text-ink">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-surface-muted/60">
              <th scope="col" className={cn(CELL, HEAD, 'text-start')}>
                الحساب
              </th>
              <th scope="col" className={cn(CELL, HEAD, 'text-end')}>
                مدين
              </th>
              <th scope="col" className={cn(CELL, HEAD, 'text-end')}>
                دائن
              </th>
            </tr>
          </thead>
          {body}
        </table>
      </div>
    </div>
  );
}

/**
 * «القيود» (10 › القيود التلقائية, 19 › دفتر اليومية العام): the period's entries, newest pages on
 * demand, each with its lines, and each entry in a drawer with the document it came from.
 */
export function JournalPage() {
  const me = useMe();
  const digits = useDigits();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [from, setFrom] = useState(() => monthStart(today));
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState<string | null>(() => defaultBranch(me));
  const key = `${from}|${to}|${branchId ?? ''}`;
  const first = useReport(key, () => getJournal({ from, to, branchId }));
  const [more, setMore] = useState<{
    key: string;
    items: JournalEntry[];
    cursor: string | null;
    error: string | null;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<JournalEntry | null>(null);
  const base = me.settings.baseCurrency;

  const extra = more?.key === key ? more : null;
  const entries = [...(first.data?.items ?? []), ...(extra?.items ?? [])];
  const cursor = extra ? extra.cursor : (first.data?.nextCursor ?? null);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await getJournal({ from, to, branchId, cursor });
      setMore({ key, items: [...(extra?.items ?? []), ...page.items], cursor: page.nextCursor, error: null });
    } catch (error) {
      setMore({ key, items: extra?.items ?? [], cursor, error: errorMessage(error) });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <AccountingLayout title="القيود">
      <PeriodBar
        me={me}
        today={today}
        from={from}
        to={to}
        branchId={branchId}
        onFrom={setFrom}
        onTo={setTo}
        onBranch={setBranchId}
      />
      <JournalTable
        caption={`القيود من ${dayText(from, digits)} إلى ${dayText(to, digits)}`}
        entries={entries}
        base={base}
        loading={first.loading}
        error={first.error}
        onRetry={first.retry}
        onOpen={setOpen}
        empty={
          <EmptyState
            icon={ReportsIcon}
            title="لا قيود في هذه الفترة."
            description="كل فاتورة وحركة درج وإغلاق وردية يصنع قيده وحده حين يصل."
          />
        }
      />
      {extra?.error ? <Alert tone="error">{extra.error}</Alert> : null}
      {cursor && !first.loading ? (
        <Button
          variant="secondary"
          className="self-center"
          loading={loadingMore}
          onClick={() => void loadMore()}
        >
          اعرض المزيد
        </Button>
      ) : null}
      <EntrySheet entry={open} onClose={() => setOpen(null)} />
    </AccountingLayout>
  );
}
