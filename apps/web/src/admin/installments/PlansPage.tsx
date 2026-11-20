import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  PLAN_STATUS_LABELS,
  type CurrencyCode,
  type InstalmentSummary,
  type PlanListItem,
  type PlanStatus,
} from '@serva/core';
import { Alert, Button, CalendarIcon, CheckIcon, SearchField, useDigits } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { dayText } from '../../lib/dates';
import { errorMessage } from '../../lib/api';
import { useIsPhone } from '../../lib/useIsPhone';
import { Empty, RadioChips } from '../customers/parts';
import { Amt, PageTop, SalesPage, StatusPill, SxTable, type SxColumn } from '../sales/ui';
import { getSummary, listPlans } from './api';

type Filter = PlanStatus | 'all' | 'late';

/** A plan's state: quiet when it is just running, filled when it needs a look */
export function PlanStatePill({ plan }: { plan: Pick<PlanListItem, 'status' | 'lateCount'> }) {
  const label = PLAN_STATUS_LABELS[plan.status];
  if (plan.status === 'defaulted') return <StatusPill kind="danger">{label}</StatusPill>;
  if (plan.status === 'completed') {
    return (
      <StatusPill kind="ok" icon={<CheckIcon size={16} />}>
        {label}
      </StatusPill>
    );
  }
  if (plan.status === 'cancelled') return <StatusPill kind="open">{label}</StatusPill>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusPill kind="ok">{label}</StatusPill>
      {plan.lateCount > 0 ? <StatusPill kind="danger">متأخرة</StatusPill> : null}
    </span>
  );
}

/**
 * «الأقساط»: every plan a till sold on instalments, what is left of each, the next one due and what is
 * late. A plan holds no money: what the customer owes is what the customer's account says.
 */
export function PlansPage() {
  const me = useMe();
  const digits = useDigits();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('active');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<PlanListItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [base, setBase] = useState<CurrencyCode>(me.settings.baseCurrency);
  const [summary, setSummary] = useState<InstalmentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);

  // An older answer never lands over a newer one (a quick change of filter or a quick typist)
  useEffect(() => {
    let alive = true;
    setError(null);
    const query = {
      ...(filter !== 'all' && filter !== 'late' ? { status: filter } : {}),
      ...(filter === 'late' ? { overdue: true } : {}),
      ...(q ? { q } : {}),
    };
    listPlans(query)
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setHasMore(r.hasMore === true);
        setBase(r.baseCurrency);
      })
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [filter, q, attempt]);
  useEffect(() => {
    let alive = true;
    getSummary()
      .then((s) => alive && setSummary(s))
      .catch(() => alive && setSummary(null));
    return () => {
      alive = false;
    };
  }, []);

  const kpi = (value: ReactNode) => (summary ? value : <span className="sx-z">—</span>);

  const columns: SxColumn<PlanListItem>[] = [
    {
      key: 'customer',
      header: 'الزبون',
      lead: true,
      cell: (p) => (
        <>
          <Link to={`/installments/${p.id}`} className="sx-rowbtn inline-flex items-center hover:underline">
            {p.customerName}
          </Link>
          <span className="sx-subline">
            <bdi dir="ltr" className="sx-n">
              {p.number}
            </bdi>
          </span>
        </>
      ),
    },
    { key: 'status', header: 'الحالة', cell: (p) => <PlanStatePill plan={p} /> },
    {
      key: 'remaining',
      header: 'المتبقي',
      numeric: true,
      strong: true,
      cell: (p) => <Amt minor={p.remainingMinor} currency={base} />,
    },
    {
      key: 'next',
      header: 'التالي',
      cell: (p) =>
        p.nextDueDate ? (
          <>
            <span className="sx-n">{dayText(p.nextDueDate, digits)}</span>
            <span className="sx-subline">
              <Amt minor={p.nextDueMinor} currency={base} />
              {p.lateMinor > 0 ? (
                <span className="cx-late">
                  {' · '}متأخر <Amt minor={p.lateMinor} currency={base} />
                </span>
              ) : null}
            </span>
          </>
        ) : (
          <span className="sx-z">—</span>
        ),
    },
    {
      key: 'financed',
      header: 'قيمة الخطة',
      numeric: true,
      hideBelowLg: true,
      cell: (p) => <Amt minor={p.financedMinor} currency={base} className="sx-mute" />,
    },
  ];

  const rows = items ?? [];
  const noLate = summary && summary.lateCount === 0;

  return (
    <AppShell>
      <title>الأقساط · SERVA</title>
      <SalesPage>
        <PageTop
          title="الأقساط"
          subtitle="كل ما بيع بالتقسيط: كم بقي على كل زبون، ومتى القسط القادم، وما تأخر."
          actions={
            <>
              <Link to="/installments/due">
                <Button icon={<CalendarIcon />}>متابعة الأقساط</Button>
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
        <div className="sx-card sx-strip cx3">
          <div>
            <span className="sx-eyebrow">المتبقي على كل الخطط</span>
            <span className="v">{kpi(<Amt minor={summary?.outstandingMinor ?? 0} currency={base} />)}</span>
            {summary ? <span className="cx-sub">{String(summary.activePlans)} خطة جارية</span> : null}
          </div>
          <div>
            <span className="sx-eyebrow">مستحق اليوم</span>
            <span className="v">
              {kpi(<Amt minor={summary?.dueTodayMinor ?? 0} currency={base} zero="dash" />)}
            </span>
            {summary ? <span className="cx-sub">{String(summary.dueTodayCount)} قسط</span> : null}
          </div>
          <div>
            <span className="sx-eyebrow">متأخر</span>
            <span className="v">
              {kpi(<Amt minor={summary?.lateMinor ?? 0} currency={base} zero="dash" neg />)}
            </span>
            {summary ? (
              noLate ? (
                <span className="cx-sub cx-ok">
                  <CheckIcon size={16} /> لا شيء متأخر
                </span>
              ) : (
                <span className="cx-sub">{String(summary.lateCount)} قسط</span>
              )
            ) : null}
          </div>
        </div>
        <div className="sx-card sx-filterbar print:hidden">
          <RadioChips
            name="plans-filter"
            label="اعرض"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'active', label: 'الجارية' },
              { value: 'late', label: 'المتأخرة' },
              { value: 'completed', label: 'المكتملة' },
              { value: 'cancelled', label: 'الملغاة' },
              { value: 'all', label: 'الكل' },
            ]}
          />
          <div className="sx-search">
            <SearchField
              label="ابحث باسم الزبون أو رقم الفاتورة"
              placeholder="ابحث باسم الزبون أو رقم الفاتورة"
              value={typed}
              onValueChange={setTyped}
            />
          </div>
        </div>
        {phone && rows.length > 0 ? (
          <ul className="sx-cards" aria-label="خطط الأقساط">
            {rows.map((p) => (
              <li key={p.id} className="sx-scard">
                <Link to={`/installments/${p.id}`} className="font-semibold hover:underline">
                  {p.customerName}
                </Link>
                <span className="justify-self-end font-semibold">
                  <Amt minor={p.remainingMinor} currency={base} />
                </span>
                <span className="x">
                  <PlanStatePill plan={p} />
                  <span>{p.nextDueDate ? `القسط القادم ${dayText(p.nextDueDate, digits)}` : '—'}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <SxTable
            caption="خطط الأقساط"
            columns={columns}
            rows={rows}
            rowKey={(p) => p.id}
            loading={!items && !error}
            {...(error && !items ? { error, onRetry: load } : {})}
            onRowClick={(p) => navigate(`/installments/${p.id}`)}
            empty={
              <Empty icon={<CalendarIcon size={24} />} title="لا خطط أقساط هنا.">
                <p>
                  يبدأ البيع بالتقسيط من الكاشير: اختر الزبون في «الدفع» ثم «بيع بالتقسيط». فعّله أولاً من
                  «إعدادات التقسيط».
                </p>
              </Empty>
            }
          />
        )}
        {hasMore ? (
          <p className="sx-wait" role="status">
            تظهر أحدث 300 خطة فقط. حدّد الحالة أو ابحث باسم الزبون لتصل إلى الباقي.
          </p>
        ) : null}
      </SalesPage>
    </AppShell>
  );
}
