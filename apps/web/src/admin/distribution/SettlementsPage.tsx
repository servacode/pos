import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { SETTLEMENT_STATUS_LABELS, type RepSettlementRow, type SettlementStatus } from '@serva/core';
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Money,
  PageHeader,
  SegmentedControl,
  Select,
  TruckIcon,
  type DataColumn,
} from '@serva/ui';
import { DateField } from '../../lib/DateField';
import { errorMessage } from '../../lib/api';
import { listReps, listSettlements } from './api';
import { FormFooter, useLoad } from './parts';
import { SettlementBadge } from './SettlementPage';

type Filter = SettlementStatus | 'all';

/** A day in the store's calendar as «2026-11-18», the browser's */
export const todayText = () => new Date().toLocaleDateString('en-CA');

function NewDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const reps = useLoad(listReps);
  const [repId, setRepId] = useState('');
  const [date, setDate] = useState(todayText());
  const list = (reps.data ?? []).filter((r) => r.isActive);
  const chosen = repId || list[0]?.id || '';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="تسوية جديدة"
      description="اختر المندوب واليوم، فتُجمع له أرقام يومه لتقارنها بما تعدّه منه."
    >
      <form
        aria-label="تسوية جديدة"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (chosen) void navigate(`/distribution/settlements/new?repId=${chosen}&date=${date}`);
        }}
      >
        <Select label="المندوب" value={chosen} onChange={(e) => setRepId(e.target.value)}>
          {list.map((r) => (
            <option key={r.id} value={r.id}>
              {r.userName}
            </option>
          ))}
        </Select>
        <DateField label="اليوم" value={date} onChange={setDate} required />
        <FormFooter>
          <Button variant="secondary" onClick={onClose}>
            تراجع
          </Button>
          <Button type="submit" disabled={!chosen}>
            تابع
          </Button>
        </FormFooter>
      </form>
    </Dialog>
  );
}

/** «التسوية»: the supervisor's evening record of each rep's day, and the ones waiting for approval */
export function SettlementsPage() {
  const [filter, setFilter] = useState<Filter>('draft');
  const [rows, setRows] = useState<RepSettlementRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let live = true;
    listSettlements(filter === 'all' ? {} : { status: filter })
      .then((r) => {
        if (live) {
          setRows(r);
          setError(null);
        }
      })
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [filter]);

  const columns: DataColumn<RepSettlementRow>[] = [
    {
      key: 'number',
      header: 'التسوية',
      cell: (r) => (
        <div className="flex flex-col gap-0.5 py-2">
          <Link
            to={`/distribution/settlements/${r.id}`}
            className="font-semibold underline-offset-4 hover:underline"
          >
            <bdi className="num">{r.number}</bdi>
          </Link>
          <span className="text-xs text-ink-muted">{r.repName}</span>
        </div>
      ),
    },
    {
      key: 'date',
      header: 'اليوم',
      className: 'hidden sm:table-cell',
      cell: (r) => <bdi className="num">{r.businessDate}</bdi>,
    },
    {
      key: 'diff',
      header: 'الفرق',
      numeric: true,
      cell: (r) => {
        const entries = Object.entries(r.cashDifference).filter(([, v]) => v !== 0);
        return entries.length === 0 ? (
          '—'
        ) : (
          <span className="flex flex-col">
            {entries.map(([cur, v]) => (
              <Money key={cur} minor={v} currency={cur as never} negativeTone />
            ))}
          </span>
        );
      },
    },
    { key: 'status', header: 'الحالة', cell: (r) => <SettlementBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="التسوية"
        description="سجل نهاية اليوم لكل مندوب: ما عليه أن يسلّمه، وما عددته منه، وجرد سيارته. لا يُرحِّل قيداً."
        icon={<TruckIcon />}
        actions={<Button onClick={() => setCreating(true)}>تسوية جديدة</Button>}
      />
      <SegmentedControl<Filter>
        label="الحالة"
        value={filter}
        onValueChange={setFilter}
        options={[
          { value: 'draft', label: SETTLEMENT_STATUS_LABELS.draft },
          { value: 'approved', label: SETTLEMENT_STATUS_LABELS.approved },
          { value: 'cancelled', label: SETTLEMENT_STATUS_LABELS.cancelled },
          { value: 'all', label: 'الكل' },
        ]}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <DataTable
        caption="التسويات"
        columns={columns}
        rows={rows ?? []}
        rowKey={(r) => r.id}
        loading={!rows && !error}
        empty={
          <EmptyState
            icon={TruckIcon}
            title="لا تسويات هنا."
            description="ابدأ تسوية جديدة في آخر يوم عمل كل مندوب."
          />
        }
      />
      {creating ? <NewDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}
