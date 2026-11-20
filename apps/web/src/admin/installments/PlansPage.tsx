import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  PLAN_STATUS_LABELS,
  type CurrencyCode,
  type InstalmentSummary,
  type PlanListItem,
  type PlanStatus,
} from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  CalendarIcon,
  ClockIcon,
  DataTable,
  EmptyState,
  KpiStrip,
  Money,
  PageHeader,
  SearchField,
  SegmentedControl,
  Skeleton,
  StatTile,
  type BadgeTone,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { dayText } from '../../lib/dates';
import { errorMessage } from '../../lib/api';
import { getSummary, listPlans } from './api';

type Filter = PlanStatus | 'all' | 'late';

const STATUS_TONE: Record<PlanStatus, BadgeTone> = {
  active: 'brand',
  completed: 'success',
  cancelled: 'neutral',
  defaulted: 'danger',
};

/**
 * «الأقساط»: every plan a till sold on instalments, what is left of each, the next one due and what is
 * late. A plan holds no money: what the customer owes is what the customer's account says.
 */
export function PlansPage() {
  const me = useMe();
  const digits = me.settings.numberFormat;
  const [filter, setFilter] = useState<Filter>('active');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<PlanListItem[] | null>(null);
  const [base, setBase] = useState<CurrencyCode>('SYP');
  const [summary, setSummary] = useState<InstalmentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    const query = {
      ...(filter !== 'all' && filter !== 'late' ? { status: filter } : {}),
      ...(filter === 'late' ? { overdue: true } : {}),
      ...(q.trim() ? { q: q.trim() } : {}),
    };
    listPlans(query)
      .then((r) => {
        setItems(r.items);
        setBase(r.baseCurrency);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [filter, q]);
  useEffect(load, [load]);
  useEffect(() => {
    getSummary()
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  const kpi = (value: ReactNode) => (summary ? value : error ? '—' : <Skeleton className="h-9 w-24" />);

  const columns: DataColumn<PlanListItem>[] = [
    {
      key: 'customer',
      header: 'الزبون',
      cell: (p) => (
        <Link to={`/installments/${p.id}`} className="flex flex-col py-2 hover:underline">
          <span className="line-clamp-2 font-semibold">{p.customerName}</span>
          <bdi dir="ltr" className="num text-xs whitespace-nowrap text-ink-muted">
            {p.number}
          </bdi>
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (p) => (
        <span className="flex flex-wrap items-center gap-1">
          <Badge tone={STATUS_TONE[p.status]}>{PLAN_STATUS_LABELS[p.status]}</Badge>
          {p.lateCount > 0 ? <Badge tone="danger">متأخرة</Badge> : null}
        </span>
      ),
    },
    {
      key: 'remaining',
      header: 'المتبقي',
      numeric: true,
      cell: (p) => <Money minor={p.remainingMinor} currency={base} className="font-semibold" />,
    },
    {
      key: 'next',
      header: 'القسط القادم',
      className: 'hidden sm:table-cell',
      cell: (p) =>
        p.nextDueDate ? (
          <span className="flex flex-col">
            <span className="whitespace-nowrap">{dayText(p.nextDueDate, digits)}</span>
            <Money minor={p.nextDueMinor} currency={base} className="text-xs text-ink-muted" />
          </span>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      key: 'late',
      header: 'المتأخر',
      numeric: true,
      className: 'hidden md:table-cell',
      cell: (p) =>
        p.lateMinor > 0 ? (
          <Money minor={p.lateMinor} currency={base} className="font-semibold text-danger-ink" />
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      key: 'financed',
      header: 'قيمة الخطة',
      numeric: true,
      className: 'hidden lg:table-cell',
      cell: (p) => <Money minor={p.financedMinor} currency={base} />,
    },
  ];

  return (
    <AppShell>
      <title>الأقساط · SERVA</title>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          title="الأقساط"
          description="كل ما بيع بالتقسيط: كم بقي على كل زبون، ومتى القسط القادم، وما تأخر."
          actions={
            <>
              <Link to="/installments/due">
                <Button variant="secondary" icon={<CalendarIcon />}>
                  متابعة الأقساط
                </Button>
              </Link>
              {me.user.permissions.includes('settings.manage') ? (
                <Link to="/installments/settings">
                  <Button variant="secondary">إعدادات التقسيط</Button>
                </Link>
              ) : null}
            </>
          }
        />
        {error && items ? <Alert tone="error">{error}</Alert> : null}
        <KpiStrip columns={3}>
          <StatTile
            label="مستحق اليوم"
            icon={<CalendarIcon />}
            iconTone="warning"
            value={kpi(<Money minor={summary?.dueTodayMinor ?? 0} currency={base} />)}
            footnote={summary ? `${String(summary.dueTodayCount)} قسط` : undefined}
          />
          <StatTile
            label="متأخر"
            icon={<ClockIcon />}
            iconTone="danger"
            value={kpi(<Money minor={summary?.lateMinor ?? 0} currency={base} />)}
            footnote={summary ? `${String(summary.lateCount)} قسط` : undefined}
          />
          <StatTile
            label="المتبقي على كل الخطط"
            icon={<ClockIcon />}
            iconTone="neutral"
            value={kpi(<Money minor={summary?.outstandingMinor ?? 0} currency={base} />)}
            footnote={summary ? `${String(summary.activePlans)} خطة جارية` : undefined}
          />
        </KpiStrip>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              label="اعرض"
              value={filter}
              onValueChange={setFilter}
              options={[
                { value: 'active', label: 'الجارية' },
                { value: 'late', label: 'المتأخرة' },
                { value: 'completed', label: 'المكتملة' },
                { value: 'cancelled', label: 'الملغاة' },
                { value: 'all', label: 'الكل' },
              ]}
            />
            <SearchField
              label="ابحث باسم الزبون أو رقم الفاتورة"
              placeholder="ابحث باسم الزبون أو رقم الفاتورة"
              value={q}
              onValueChange={setQ}
            />
          </div>
          <DataTable
            caption="خطط الأقساط"
            columns={columns}
            rows={items ?? []}
            rowKey={(p) => p.id}
            loading={!items && !error}
            {...(error && !items ? { error, onRetry: load } : {})}
            empty={
              <EmptyState
                icon={CalendarIcon}
                title="لا خطط أقساط هنا."
                description="يبدأ البيع بالتقسيط من الكاشير: اختر الزبون في «الدفع» ثم «بيع بالتقسيط». فعّله أولاً من «إعدادات التقسيط»."
              />
            }
          />
        </div>
      </div>
    </AppShell>
  );
}
