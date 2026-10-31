import { useState } from 'react';
import { Link } from 'react-router';
import type { CurrencyCode } from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Money,
  ReportsIcon,
  Sheet,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import { dayText, isoDay, monthStart } from '../../lib/dates';
import { getJournal } from '../reports/api';
import type { JournalEntry, JournalLine } from '../reports/contracts';
import { sourceLabel } from '../reports/labels';
import { BranchSelect, DayField, defaultBranch } from '../reports/parts';
import { useReport } from '../reports/useReport';
import { AccountingLayout } from './AccountingLayout';

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

function lineColumns(base: CurrencyCode): DataColumn<JournalLine>[] {
  return [
    {
      key: 'account',
      header: 'الحساب',
      cell: (line) => (
        <span className="flex flex-col">
          <span>
            <bdi className="num text-ink-muted">{line.accountCode}</bdi> {line.accountName}
          </span>
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
      ),
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
          <div className="flex flex-col gap-1">
            <span className="text-sm text-ink-muted">المستند</span>
            <SourceLink entry={entry} />
          </div>
          {entry.memo ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm text-ink-muted">البيان</span>
              <span className="text-ink">{entry.memo}</span>
            </div>
          ) : null}
          <DataTable
            caption={`سطور القيد ${entry.number}`}
            columns={columns}
            rows={entry.lines}
            rowKey={(line) => `${line.accountCode}-${line.debitMinor}-${line.creditMinor}-${line.currency}`}
          />
          {debit === credit ? (
            <Badge tone="success" className="self-start">
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

/**
 * «القيود» (10 › القيود التلقائية, 19 › دفتر اليومية العام): the period's entries, newest pages on
 * demand, and each entry in a drawer with its lines and the document it came from.
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

  const columns: DataColumn<JournalEntry>[] = [
    {
      key: 'number',
      header: 'رقم القيد',
      cell: (entry) => (
        <button
          type="button"
          onClick={() => setOpen(entry)}
          className="inline-flex min-h-11 items-center font-semibold text-brand-ink underline-offset-4 hover:underline"
        >
          <bdi dir="ltr" className="num">
            {entry.number}
          </bdi>
        </button>
      ),
    },
    { key: 'date', header: 'التاريخ', cell: (entry) => dayText(entry.date, digits) },
    { key: 'source', header: 'المستند', cell: (entry) => <SourceLink entry={entry} /> },
    { key: 'memo', header: 'البيان', cell: (entry) => entry.memo ?? '—' },
    {
      key: 'total',
      header: 'المبلغ',
      numeric: true,
      cell: (entry) => <Money minor={entry.totalMinor} currency={base} />,
    },
  ];

  return (
    <AccountingLayout title="القيود">
      <Card className="flex flex-wrap items-end gap-4">
        <DayField label="من" value={from} max={to} onChange={setFrom} />
        <DayField label="إلى" value={to} max={today} onChange={setTo} />
        <BranchSelect me={me} value={branchId} onChange={setBranchId} />
      </Card>
      <DataTable
        caption={`القيود من ${dayText(from, digits)} إلى ${dayText(to, digits)}`}
        columns={columns}
        rows={entries}
        rowKey={(entry) => entry.id}
        loading={first.loading}
        error={first.error ?? undefined}
        onRetry={first.retry}
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
