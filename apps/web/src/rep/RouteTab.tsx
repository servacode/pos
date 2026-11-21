import { useMemo, useState } from 'react';
import { dayProgress, offRouteNeedsReason, type RouteStop, type StopStatus } from '@serva/core/distribution';
import { normalizeArabic } from '@serva/core/text';
import {
  AddIcon,
  Alert,
  Avatar,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Money,
  ProgressBar,
  SearchIcon,
  TextField,
  TruckIcon,
  type BadgeTone,
} from '@serva/ui';
import type { Catalog } from '../pos/catalog';
import { useRepRequired } from './state';

const STATUS: Record<StopStatus, { label: string; tone: BadgeTone }> = {
  todo: { label: 'لم تُزر', tone: 'neutral' },
  sold: { label: 'بيع', tone: 'success' },
  order: { label: 'طلبية', tone: 'info' },
  collected: { label: 'تحصيل', tone: 'success' },
  returned: { label: 'مرتجع', tone: 'warning' },
  no_sale: { label: 'بلا بيع', tone: 'warning' },
  visited: { label: 'زيارة', tone: 'neutral' },
};

/**
 * «خط السير» of today: the customers in visiting order, each with where the visit stands, and a
 * search to go to a customer who is not on today's list (which asks why when the store wants it).
 */
export function RouteTab({
  catalog,
  baseCurrency,
  onOpen,
  onNewCustomer,
}: {
  catalog: Catalog;
  baseCurrency: string;
  onOpen: (customerId: string) => void;
  onNewCustomer: () => void;
}) {
  const rep = useRepRequired();
  const [search, setSearch] = useState('');
  const [ask, setAsk] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const customers = useMemo(() => new Map(catalog.customers.map((c) => [c.id, c])), [catalog.customers]);
  const sheetOf = useMemo(() => new Map((rep.sheet?.customers ?? []).map((c) => [c.id, c])), [rep.sheet]);
  const progress = dayProgress(rep.list.stops);
  const settings = rep.sheet?.settings ?? { offRouteNeedsReason: true };
  const q = normalizeArabic(search);

  const shown = rep.list.stops.filter((s) => {
    if (!q) return true;
    return normalizeArabic(customers.get(s.customerId)?.name ?? '').includes(q);
  });
  // Someone outside today's list: found by name, or visited today already
  const onList = new Set(rep.list.stops.map((s) => s.customerId));
  const others = q
    ? catalog.customers
        .filter((c) => !onList.has(c.id) && !c.archived && normalizeArabic(c.name).includes(q))
        .slice(0, 8)
    : [];
  const offToday = rep.visits.filter((v) => !onList.has(v.customerId)).map((v) => v.customerId);

  function open(customerId: string) {
    if (!onList.has(customerId) && offRouteNeedsReason(customerId, rep.list.stops, settings)) {
      setAsk(customerId);
      return;
    }
    onOpen(customerId);
  }

  const row = (s: RouteStop | null, customerId: string) => {
    const c = customers.get(customerId);
    const sheet = sheetOf.get(customerId);
    const status = s ? STATUS[s.status] : null;
    return (
      <li key={customerId}>
        <button
          type="button"
          onClick={() => open(customerId)}
          className="flex min-h-16 w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-start transition-colors duration-120 ease-standard hover:bg-surface-muted"
        >
          {s ? (
            <span className="num grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-sm font-bold text-ink-muted">
              {s.position}
            </span>
          ) : (
            <Avatar name={c?.name ?? '?'} />
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold text-ink">{c?.name ?? '—'}</span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              {sheet && sheet.balanceMinor > 0 ? (
                <span>
                  عليه <Money minor={sheet.balanceMinor} currency={baseCurrency as never} />
                </span>
              ) : null}
              {sheet && sheet.overdueMinor > 0 ? <Badge tone="danger">متأخر</Badge> : null}
              {c?.approvalStatus === 'pending' ? <Badge tone="warning">بانتظار الموافقة</Badge> : null}
            </span>
          </span>
          {status ? <Badge tone={status.tone}>{status.label}</Badge> : <Badge>خارج الخط</Badge>}
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {rep.list.stops.length > 0 ? (
        <section aria-label="تقدّم اليوم" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-ink">
              زُرت <span className="num">{progress.done}</span> من{' '}
              <span className="num">{progress.total}</span>
            </p>
            <p className="text-xs text-ink-muted">
              بيع <span className="num">{progress.sold}</span> · بلا بيع{' '}
              <span className="num">{progress.noSale}</span>
            </p>
          </div>
          <ProgressBar
            label="زيارات اليوم"
            value={progress.percent}
            tone={progress.percent === 100 ? 'success' : 'brand'}
          />
          <p className="text-xs text-ink-muted">{rep.list.routes.map((r) => r.name).join(' · ')}</p>
        </section>
      ) : null}
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <TextField
            label="ابحث عن زبون"
            value={search}
            onChange={(e) => setSearch(e.target.value.slice(0, 60))}
            startAdornment={<SearchIcon className="ms-4 shrink-0" />}
          />
        </div>
      </div>
      <Button variant="secondary" icon={<AddIcon />} onClick={onNewCustomer}>
        زبون جديد
      </Button>
      {rep.list.stops.length === 0 ? (
        <EmptyState
          icon={TruckIcon}
          title="لا زبائن في خط اليوم."
          description={
            rep.routes.length === 0
              ? 'لم يُسند إليك خط سير بعد، أو لم يصل إلى الجهاز. اطلب من المشرف إسناد خط ثم اتصل بالإنترنت.'
              : 'خطوطك لا تعمل اليوم. ابحث عن زبون لزيارته.'
          }
        />
      ) : (
        <ul aria-label="خط سير اليوم" className="flex flex-col gap-2">
          {shown.map((s) => row(s, s.customerId))}
          {shown.length === 0 ? (
            <li className="py-4 text-center text-sm text-ink-muted">لا زبون بهذا الاسم في خط اليوم.</li>
          ) : null}
        </ul>
      )}
      {others.length > 0 ? (
        <section aria-label="خارج الخط" className="flex flex-col gap-2">
          <h3 className="text-sm font-bold text-ink">خارج خط اليوم</h3>
          <ul className="flex flex-col gap-2">{others.map((c) => row(null, c.id))}</ul>
        </section>
      ) : null}
      {offToday.length > 0 && !q ? (
        <section aria-label="زيارات خارج الخط" className="flex flex-col gap-2">
          <h3 className="text-sm font-bold text-ink">زرتهم خارج الخط</h3>
          <ul className="flex flex-col gap-2">{[...new Set(offToday)].map((id) => row(null, id))}</ul>
        </section>
      ) : null}
      {rep.sheetState === 'forbidden' ? (
        <Alert tone="error">
          هذا الجهاز غير مضبوط كهاتف مندوب، أو لا مندوب فعّالاً على سيارته. راجع المشرف.
        </Alert>
      ) : null}
      {ask ? (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setAsk(null);
          }}
          size="sm"
          title="زبون خارج خط اليوم"
          description="اكتب سبب الزيارة."
          actions={
            <>
              <Button variant="secondary" onClick={() => setAsk(null)}>
                إلغاء
              </Button>
              <Button
                disabled={why.trim().length < 2}
                onClick={() => {
                  const id = ask;
                  setAsk(null);
                  rep.enter(id, why.trim());
                  setWhy('');
                  onOpen(id);
                }}
              >
                تابع
              </Button>
            </>
          }
        >
          <TextField label="السبب" value={why} onChange={(e) => setWhy(e.target.value.slice(0, 200))} />
        </Dialog>
      ) : null}
    </div>
  );
}
