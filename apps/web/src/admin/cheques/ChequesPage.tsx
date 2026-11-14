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

/** Cheques still waiting whose due day is today or within the next days; the home page counts them too */
export function dueSoon(items: readonly Cheque[], day: string): Cheque[] {
  const until = addDays(day, CHEQUE_DUE_SOON_DAYS);
  return items.filter((c) => c.status === 'pending' && c.dueDate && c.dueDate <= until);
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
      ? [...(items ?? [])].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
      : (items ?? []);
  const soon = dueSoon(items ?? [], today());
  const pendingTotal = (items ?? [])
    .filter((c) => c.status === 'pending' && c.direction !== 'out')
    .reduce((sum, c) => sum + c.amountMinor, 0);
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
        <span className="flex flex-col items-start">
          <span>{c.bank ?? <span className="text-ink-subtle">—</span>}</span>
          {c.drawer ? <span className="text-xs text-ink-muted">الساحب: {c.drawer}</span> : null}
        </span>
      ),
    },
    {
      key: 'due',
      header: 'الاستحقاق',
      cell: (c) =>
        c.dueDate ? (
          <bdi
            className={`num whitespace-nowrap ${
              c.status === 'pending' && c.dueDate <= today() ? 'font-semibold text-danger-ink' : 'text-ink'
            }`}
          >
            {c.dueDate}
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
              onClick={() => void mark(c, 'cleared')}
            >
              حُصّل
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<UndoIcon size={16} />}
              onClick={() => void mark(c, 'bounced')}
            >
              مرتجع
            </Button>
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
        <div className="grid gap-4 sm:grid-cols-2">
          <StatTile
            label="تحت التحصيل"
            icon={<ClockIcon />}
            iconTone="warning"
            value={kpi(<Money minor={pendingTotal} currency={base} />)}
          />
          <StatTile
            label="عدد الشيكات"
            icon={<ChequeIcon />}
            iconTone="neutral"
            value={kpi(<bdi className="num">{items?.length ?? 0}</bdi>)}
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
    </AppShell>
  );
}
