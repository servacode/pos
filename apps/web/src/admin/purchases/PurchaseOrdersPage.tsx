import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  PURCHASE_ORDER_STATUS_LABELS,
  type PurchaseOrderListResponse,
  type PurchaseOrderRow,
  type PurchaseOrderStatus,
} from '@serva/core';
import {
  AddIcon,
  Alert,
  Button,
  EmptyState,
  formatQuantity,
  ListIcon,
  useDigits,
  type BadgeTone,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { ReportScreen } from '../reports/parts';
import { errorMessage } from '../../lib/api';
import { dayText } from '../../lib/dates';
import { useIsPhone } from '../../lib/useIsPhone';
import { Amt, PageTop, SalesPage, StatusPill, SxTable, type SxColumn } from '../sales/ui';
import { storeToday } from './api';
import { listOrders } from './orderApi';
import { OrderPill } from './pui';
import './purchases.css';

export const ORDER_TONES: Record<PurchaseOrderStatus, BadgeTone> = {
  draft: 'neutral',
  sent: 'info',
  partial: 'warning',
  received: 'success',
  cancelled: 'danger',
};

type Filter = 'all' | PurchaseOrderStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'draft', label: PURCHASE_ORDER_STATUS_LABELS.draft },
  { value: 'sent', label: PURCHASE_ORDER_STATUS_LABELS.sent },
  { value: 'partial', label: PURCHASE_ORDER_STATUS_LABELS.partial },
  { value: 'received', label: PURCHASE_ORDER_STATUS_LABELS.received },
  { value: 'cancelled', label: PURCHASE_ORDER_STATUS_LABELS.cancelled },
];

const isOpen = (r: PurchaseOrderRow) => r.status === 'sent' || r.status === 'partial';
/** Closed with less than was asked for: «مستلمة» alone would read as complete */
const closedShort = (r: PurchaseOrderRow) => r.status === 'received' && r.receivedQty < r.orderedQty;

/**
 * «طلبيات الشراء»: what the store asked its suppliers for, newest first, with how much of each has
 * arrived. An order is a promise only: it posts nothing and moves no stock until its goods are
 * received as an ordinary purchase. Round 44: the Sales language, a count on every state, and the
 * answers of a slow earlier request never overwrite the list of the state picked now.
 */
export function PurchaseOrdersPage() {
  const me = useMe();
  const digits = useDigits();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const base = me.settings.baseCurrency;
  const today = storeToday(me.tenant.timezone);
  const [status, setStatus] = useState<Filter>('all');
  const [all, setAll] = useState<PurchaseOrderRow[] | null>(null);
  // More orders than one read brings (4000): said, never cut silently
  const [more, setMore] = useState<string | null>(null);
  const [serverCounts, setServerCounts] = useState<PurchaseOrderListResponse['counts']>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // One read of every order; the states, their counts and the rows come from it (only the newest answer is kept)
  useEffect(() => {
    let alive = true;
    setError(null);
    listOrders().then(
      (r) => {
        if (!alive) return;
        setAll(r.items);
        setMore(r.nextCursor ?? null);
        setServerCounts(r.counts);
      },
      (e: unknown) => alive && setError(errorMessage(e)),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);
  const retry = useCallback(() => {
    setAll(null);
    setAttempt((n) => n + 1);
  }, []);

  const counts = useMemo(() => {
    const out: Record<Filter, number> = { all: 0, draft: 0, sent: 0, partial: 0, received: 0, cancelled: 0 };
    // Round 62: the server counts every order of the store, not only the rows loaded here
    if (serverCounts) {
      for (const key of Object.keys(serverCounts) as PurchaseOrderStatus[]) {
        out[key] = serverCounts[key] ?? 0;
        out.all += serverCounts[key] ?? 0;
      }
      return out;
    }
    for (const r of all ?? []) {
      out.all += 1;
      out[r.status] += 1;
    }
    return out;
  }, [all, serverCounts]);
  const loadOlder = () => {
    if (!more) return;
    setLoadingMore(true);
    listOrders(undefined, more).then(
      (r) => {
        setAll((rows) => {
          const known = new Set((rows ?? []).map((x) => x.id));
          return [...(rows ?? []), ...r.items.filter((x) => !known.has(x.id))];
        });
        setMore(r.nextCursor ?? null);
        setLoadingMore(false);
      },
      (e: unknown) => {
        setError(errorMessage(e));
        setLoadingMore(false);
      },
    );
  };
  const rows = useMemo(
    () => (all ?? []).filter((r) => status === 'all' || r.status === status),
    [all, status],
  );

  const progress = (r: PurchaseOrderRow) => {
    const share = r.orderedQty > 0 ? Math.min(100, Math.round((r.receivedQty / r.orderedQty) * 100)) : 0;
    return (
      <span className="px-prog">
        <span className="t">
          {formatQuantity(r.receivedQty, digits)} / {formatQuantity(r.orderedQty, digits)}
        </span>
        <span
          className={`px-bar ${r.receivedQty >= r.orderedQty ? 'done' : ''}`}
          role="progressbar"
          aria-label={`المستلم من ${r.number}`}
          aria-valuenow={share}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ width: `${share}%` }} />
        </span>
      </span>
    );
  };

  const columns: SxColumn<PurchaseOrderRow>[] = [
    {
      key: 'number',
      header: 'الرقم',
      lead: true,
      cell: (r) => (
        <Link to={`/purchase-orders/${r.id}`} className="sx-rowbtn">
          <bdi dir="ltr" className="sx-n sx-no">
            {r.number}
          </bdi>
        </Link>
      ),
    },
    { key: 'supplier', header: 'المورد', cell: (r) => r.supplierName },
    {
      key: 'date',
      header: 'التاريخ',
      hideBelowLg: true,
      cell: (r) => <span className="sx-mute">{dayText(r.date, digits)}</span>,
    },
    {
      key: 'expected',
      header: 'التسليم المتوقع',
      hideBelowLg: true,
      cell: (r) =>
        r.expectedDate ? (
          <span className="sx-mute">
            {dayText(r.expectedDate, digits)}
            {isOpen(r) && r.expectedDate < today ? (
              <>
                {' '}
                <StatusPill kind="danger">متأخرة</StatusPill>
              </>
            ) : null}
          </span>
        ) : (
          <span className="sx-sub">—</span>
        ),
    },
    { key: 'received', header: 'المستلم', cell: progress },
    {
      key: 'total',
      header: 'المجموع',
      numeric: true,
      strong: true,
      cell: (r) => <Amt minor={r.totalMinor} currency={base} />,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => <OrderPill status={r.status} short={closedShort(r)} />,
    },
  ];

  return (
    <ReportScreen me={me} access={['purchases.manage']} title="طلبيات الشراء">
      <SalesPage>
        <PageTop
          title="طلبيات الشراء"
          subtitle="اطلب من مورّدك ما ينقص، وتابع ما وصل منه. الطلبية وعد فقط: لا تسجّل شراءً ولا تدخل المخزون."
          actions={
            <Button icon={<AddIcon />} onClick={() => void navigate('/purchase-orders/new')}>
              طلبية جديدة
            </Button>
          }
        />
        {more ? (
          <Alert tone="warning">
            <span className="flex flex-wrap items-center gap-3">
              الطلبيات أكثر من أن تُعرض كلها: ظهرت الأحدث فقط.
              <Button variant="secondary" size="sm" loading={loadingMore} onClick={loadOlder}>
                حمّل الأقدم
              </Button>
            </span>
          </Alert>
        ) : null}
        <div role="radiogroup" aria-label="حالة الطلبية" className="sx-chips px-chips">
          {FILTERS.filter((f) => f.value === 'all' || f.value === status || counts[f.value] > 0 || !all).map(
            (f) => (
              <label key={f.value} className="sx-chip">
                <input
                  type="radio"
                  name="order-status"
                  checked={status === f.value}
                  onChange={() => setStatus(f.value)}
                />
                {f.label}
                {all ? <span className="c sx-n">{counts[f.value].toLocaleString('en-US')}</span> : null}
              </label>
            ),
          )}
        </div>
        {phone && rows.length > 0 ? (
          <ul className="sx-cards" aria-label="طلبيات الشراء">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="sx-icard px-amt-first"
                  aria-label={`افتح الطلبية ${r.number}`}
                  onClick={() => void navigate(`/purchase-orders/${r.id}`)}
                >
                  <span className="n">{r.number}</span>
                  <span className="st">
                    <OrderPill status={r.status} short={closedShort(r)} />
                  </span>
                  <span className="d">
                    {r.supplierName} · {dayText(r.date, digits)}
                  </span>
                  <span className="t">
                    <Amt minor={r.totalMinor} currency={base} />
                  </span>
                  <span className="x">{progress(r)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <SxTable
            caption="طلبيات الشراء"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => void navigate(`/purchase-orders/${r.id}`)}
            loading={all === null && !error}
            error={error ?? undefined}
            onRetry={retry}
            empty={
              <EmptyState
                icon={ListIcon}
                title="لا طلبيات شراء هنا"
                description="اضغط «طلبية جديدة»، أو اختر مورداً واضغط «اقترح طلبية» ليجمع لك ما نقص عنده."
              />
            }
          />
        )}
      </SalesPage>
    </ReportScreen>
  );
}
