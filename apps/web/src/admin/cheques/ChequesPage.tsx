import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CHEQUE_DUE_SOON_DAYS, type Cheque, type ChequeStatus, type CurrencyCode } from '@serva/core';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  CheckIcon,
  ChequeIcon,
  ClockIcon,
  DataTable,
  Dialog,
  EmptyState,
  Money,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatTile,
  UndoIcon,
  type BadgeTone,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { actOnCheque, listCheques } from './api';

const STATUS_TEXT: Record<ChequeStatus, string> = {
  pending: 'تحت التحصيل',
  cleared: 'حُصّل',
  bounced: 'مرتجع',
};

const STATUS_TONE: Record<ChequeStatus, BadgeTone> = {
  pending: 'warning',
  cleared: 'success',
  bounced: 'danger',
};

/** What an empty list says, per filter. */
const EMPTY_TITLE: Record<ChequeStatus | 'all', string> = {
  pending: 'لا شيكات تحت التحصيل.',
  cleared: 'لا شيكات محصّلة.',
  bounced: 'لا شيكات مرتجعة.',
  all: 'لا شيكات بعد.',
};

/** Today on the store's clock, «2026-11-03» */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(new Date());

/** The day `days` after `day` («2026-11-03», 7 → «2026-11-10»), on calendar days */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The day a cheque falls due: its own due day, or the day typed into its reference («CHQ-7 2026-11-30») */
export function dueDayOf(c: Pick<Cheque, 'dueDate' | 'reference'>): string | null {
  return c.dueDate ?? /\d{4}-\d{2}-\d{2}/.exec(c.reference ?? '')?.[0] ?? null;
}

/**
 * Cheques still waiting whose due day is within the next days. A customer's cheque counts from
 * today and also past due (it still has to be cashed or bounced); a cheque we gave a supplier has
 * no mark, so it counts only until its day. The home page counts both too.
 */
export function dueSoon(items: readonly Cheque[], day: string, direction: 'in' | 'out' = 'in'): Cheque[] {
  const until = addDays(day, CHEQUE_DUE_SOON_DAYS);
  return items.filter((c) => {
    const due = dueDayOf(c);
    if (c.status !== 'pending' || !due || due > until) return false;
    return direction === 'out' ? c.direction === 'out' && due >= day : c.direction !== 'out';
  });
}

/**
 * «الشيكات» (03 › الجملة: الآجل والشيكات): every cheque a till took, for a sale or a customer's
 * payment, waiting in «شيكات تحت التحصيل» until the owner marks it cashed into the bank or bounced
 * back onto the customer's account. Each mark is one entry in the books, and cannot be undone here.
 */
export function ChequesPage() {
  const me = useMe();
  const canManage = me.user.permissions.includes('customers.manage');
  const [filter, setFilter] = useState<ChequeStatus | 'all'>('pending');
  const [order, setOrder] = useState<'recent' | 'due'>('recent');
  const [items, setItems] = useState<Cheque[] | null>(null);
  const [base, setBase] = useState<CurrencyCode>('SYP');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // A cheque marked cashed or bounced is one entry in the books: it waits for a confirmation
  const [asking, setAsking] = useState<{ cheque: Cheque; action: 'cleared' | 'bounced' } | null>(null);

  const load = useCallback(() => {
    setError(null);
    listCheques(filter === 'all' ? undefined : filter)
      .then((r) => {
        setItems(r.items);
        setBase(r.baseCurrency);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [filter]);
  useEffect(load, [load]);

  async function mark(c: Cheque, action: 'cleared' | 'bounced') {
    if (c.sourceType === 'supplier_payment') return;
    const key = `${c.sourceId}-${c.paymentNo}`;
    setBusy(key);
    setError(null);
    try {
      await actOnCheque({
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        paymentNo: c.paymentNo,
        action,
        date: today(),
      });
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  // By due date: the soonest first, the ones without a date last
  const shown =
    order === 'due'
      ? [...(items ?? [])].sort((a, b) => (dueDayOf(a) ?? '9999').localeCompare(dueDayOf(b) ?? '9999'))
      : (items ?? []);
  const soon = dueSoon(items ?? [], today());
  const soonOut = dueSoon(items ?? [], today(), 'out');
  const pendingTotal = (items ?? [])
    .filter((c) => c.status === 'pending' && c.direction !== 'out')
    .reduce((sum, c) => sum + c.amountMinor, 0);
  const incomingCount = (items ?? []).filter((c) => c.direction !== 'out').length;
  const outgoingCount = (items ?? []).length - incomingCount;
  // A number of the tiles: a placeholder while the list loads, a dash when it could not.
  const kpi = (value: ReactNode) => (items ? value : error ? '—' : <Skeleton className="h-9 w-24" />);

  // The status: its badge, and the day it was marked under it.
  const status = (c: Cheque) => (
    <span className="flex flex-col items-start gap-0.5">
      <Badge tone={c.direction === 'out' ? 'neutral' : STATUS_TONE[c.status]}>
        {c.direction === 'out' ? 'صادر للمورد' : STATUS_TEXT[c.status]}
      </Badge>
      {c.actionDate ? <bdi className="num ps-1 text-xs text-ink-subtle">{c.actionDate}</bdi> : null}
    </span>
  );

  // On a phone the cheque's own cell carries its customer and status, so the amount and the
  // actions stay in view; from 640 px they have their own columns.
  const columns: DataColumn<Cheque>[] = [
    {
      key: 'reference',
      header: 'رقم الشيك',
      cell: (c) => (
        <div className="flex flex-col items-start gap-1 py-2.5">
          {c.reference ? (
            <bdi dir="ltr" className="num font-semibold whitespace-nowrap">
              {c.reference}
            </bdi>
          ) : (
            <span className="text-ink-subtle">بلا رقم</span>
          )}
          <span className="hidden text-xs text-ink-muted sm:block">
            <bdi dir="ltr" className="num whitespace-nowrap">
              {c.documentNumber}
            </bdi>
          </span>
          <span className="text-xs text-ink-muted sm:hidden">{c.customerName ?? '—'}</span>
          <span className="sm:hidden">{status(c)}</span>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'الزبون',
      className: 'hidden sm:table-cell',
      cell: (c) =>
        c.direction === 'out' ? (
          <span className="font-semibold">{c.supplierName ?? '—'}</span>
        ) : c.customerName ? (
          <span className="flex items-center gap-2.5">
            <Avatar name={c.customerName} size="sm" />
            <span className="font-semibold">{c.customerName}</span>
          </span>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      key: 'bank',
      header: 'البنك',
      className: 'hidden md:table-cell',
      cell: (c) => (
        <span className="flex min-w-36 flex-col items-start">
          <span>{c.bank ?? <span className="text-ink-subtle">—</span>}</span>
          {c.drawer ? <span className="text-xs text-ink-muted">الساحب: {c.drawer}</span> : null}
        </span>
      ),
    },
    {
      key: 'due',
      header: 'الاستحقاق',
      cell: (c) =>
        dueDayOf(c) ? (
          <bdi
            className={`num whitespace-nowrap ${
              c.status === 'pending' && c.direction !== 'out' && dueDayOf(c)! <= today()
                ? 'font-semibold text-danger-ink'
                : 'text-ink'
            }`}
          >
            {dueDayOf(c)}
          </bdi>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      key: 'date',
      header: 'التاريخ',
      className: 'hidden lg:table-cell',
      cell: (c) => <bdi className="num whitespace-nowrap text-ink-muted">{c.date}</bdi>,
    },
    {
      key: 'amount',
      header: 'المبلغ',
      numeric: true,
      cell: (c) => <Money minor={c.amountMinor} currency={c.currency} className="font-semibold" />,
    },
    {
      key: 'status',
      header: 'الحالة',
      className: 'hidden sm:table-cell',
      cell: status,
    },
    {
      key: 'actions',
      // Positioned, so the hidden heading stays inside the table's scroll box.
      header: <span className="sr-only">إجراءات</span>,
      className: 'relative w-px',
      cell: (c) =>
        c.status === 'pending' && canManage && c.direction !== 'out' ? (
          <span className="flex flex-col items-stretch gap-1.5 py-2 sm:flex-row sm:justify-end sm:py-0">
            <Button
              size="sm"
              variant="secondary"
              icon={<CheckIcon size={16} />}
              loading={busy === `${c.sourceId}-${c.paymentNo}`}
              onClick={() => setAsking({ cheque: c, action: 'cleared' })}
            >
              حُصّل
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<UndoIcon size={16} />}
              onClick={() => setAsking({ cheque: c, action: 'bounced' })}
            >
              مرتجع
            </Button>
          </span>
        ) : c.direction === 'out' ? (
          <span className="block min-w-32 py-2 text-xs leading-snug text-ink-muted sm:py-0 sm:text-end">
            خُصم من البنك يوم الدفع
          </span>
        ) : null,
    },
  ];

  return (
    <AppShell>
      <title>الشيكات · SERFA</title>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <PageHeader
          title="الشيكات"
          description="كل شيك قبضه الكاشير من بيع أو من دفعة زبون، حتى يُحصَّل في البنك أو يرتجع."
        />
        {error && items ? <Alert tone="error">{error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="تحت التحصيل"
            icon={<ClockIcon />}
            iconTone="warning"
            value={kpi(<Money minor={pendingTotal} currency={base} />)}
          />
          <StatTile
            label="شيكات الزبائن"
            icon={<ChequeIcon />}
            iconTone="neutral"
            value={kpi(<bdi className="num">{incomingCount}</bdi>)}
          />
          <StatTile
            label="شيكات صادرة للموردين"
            icon={<ChequeIcon />}
            iconTone="neutral"
            value={kpi(<bdi className="num">{outgoingCount}</bdi>)}
          />
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              label="اعرض"
              value={filter}
              onValueChange={setFilter}
              options={[
                { value: 'pending', label: 'تحت التحصيل' },
                { value: 'cleared', label: 'المحصّلة' },
                { value: 'bounced', label: 'المرتجعة' },
                { value: 'all', label: 'الكل' },
              ]}
            />
            <SegmentedControl
              label="رتّب"
              value={order}
              onValueChange={setOrder}
              options={[
                { value: 'recent', label: 'الأحدث' },
                { value: 'due', label: 'تاريخ الاستحقاق' },
              ]}
            />
          </div>
          {soon.length > 0 ? (
            <Alert tone="warning">
              <bdi className="num">{soon.length}</bdi> {soon.length === 1 ? 'شيك يستحق' : 'شيكات تستحق'} خلال{' '}
              {CHEQUE_DUE_SOON_DAYS} أيام أو فات موعدها.
            </Alert>
          ) : null}
          {soonOut.length > 0 ? (
            <Alert tone="warning">
              <bdi className="num">{soonOut.length}</bdi>{' '}
              {soonOut.length === 1 ? 'شيك صادر للمورد يستحق' : 'شيكات صادرة للموردين تستحق'} خلال{' '}
              {CHEQUE_DUE_SOON_DAYS} أيام: جهّز الرصيد في البنك.
            </Alert>
          ) : null}
          <Alert tone="info">
            «حُصّل» ينقل المبلغ إلى البنك. «مرتجع» يعيده ديناً على الزبون في كشف حسابه. كل منهما قيد واحد في
            الدفاتر.
          </Alert>
          <DataTable
            caption="الشيكات"
            columns={columns}
            rows={shown}
            rowKey={(c) => `${c.sourceType}-${c.sourceId}-${c.paymentNo}`}
            loading={!items && !error}
            {...(error && !items ? { error, onRetry: load } : {})}
            empty={
              <EmptyState
                icon={ChequeIcon}
                title={EMPTY_TITLE[filter]}
                description="الكاشير يقبل الشيك من «الدفع» بعد اختيار الزبون."
              />
            }
          />
        </div>
      </div>
      <Dialog
        open={asking !== null}
        onOpenChange={(o) => !o && setAsking(null)}
        title={asking?.action === 'bounced' ? 'سجّل الشيك مرتجعاً' : 'سجّل الشيك محصّلاً'}
        description={asking?.cheque.reference ?? asking?.cheque.documentNumber}
        actions={
          <>
            <Button variant="secondary" onClick={() => setAsking(null)}>
              تراجع
            </Button>
            <Button
              onClick={() => {
                const a = asking;
                setAsking(null);
                if (a) void mark(a.cheque, a.action);
              }}
            >
              {asking?.action === 'bounced' ? 'نعم، مرتجع' : 'نعم، حُصّل'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          {asking?.action === 'bounced'
            ? 'يعود المبلغ ديناً على الزبون في كشف حسابه، ولا يمكن التراجع عن هذا من هنا.'
            : 'ينتقل المبلغ إلى البنك، ولا يمكن التراجع عن هذا من هنا.'}
        </p>
      </Dialog>
    </AppShell>
  );
}
