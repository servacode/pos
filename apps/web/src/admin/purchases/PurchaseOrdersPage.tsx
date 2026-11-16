import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PURCHASE_ORDER_STATUS_LABELS, type PurchaseOrderRow, type PurchaseOrderStatus } from '@serva/core';
import {
  AddIcon,
  Badge,
  Button,
  DataTable,
  EmptyState,
  formatQuantity,
  ListIcon,
  Money,
  PageHeader,
  SegmentedControl,
  useDigits,
  type BadgeTone,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { ReportScreen } from '../reports/parts';
import { errorMessage } from '../../lib/api';
import { dayText } from '../../lib/dates';
import { listOrders } from './orderApi';

export const ORDER_TONES: Record<PurchaseOrderStatus, BadgeTone> = {
  draft: 'neutral',
  sent: 'info',
  partial: 'warning',
  received: 'success',
  cancelled: 'danger',
};

const FILTERS: { value: 'all' | PurchaseOrderStatus; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'draft', label: PURCHASE_ORDER_STATUS_LABELS.draft },
  { value: 'sent', label: PURCHASE_ORDER_STATUS_LABELS.sent },
  { value: 'partial', label: PURCHASE_ORDER_STATUS_LABELS.partial },
  { value: 'received', label: PURCHASE_ORDER_STATUS_LABELS.received },
  { value: 'cancelled', label: PURCHASE_ORDER_STATUS_LABELS.cancelled },
];

/**
 * «طلبيات الشراء»: what the store asked its suppliers for, newest first, with how much of each has
 * arrived. An order is a promise only: it posts nothing and moves no stock until its goods are
 * received as an ordinary purchase.
 */
export function PurchaseOrdersPage() {
  const me = useMe();
  const digits = useDigits();
  const navigate = useNavigate();
  const base = me.settings.baseCurrency;
  const [status, setStatus] = useState<'all' | PurchaseOrderStatus>('all');
  const [rows, setRows] = useState<PurchaseOrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setRows(null);
    listOrders(status === 'all' ? undefined : status)
      .then((r) => setRows(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [status]);
  useEffect(load, [load]);

  const progress = (r: PurchaseOrderRow) => (
    <span className="num text-sm whitespace-nowrap text-ink-muted">
      {formatQuantity(r.receivedQty, digits)} من {formatQuantity(r.orderedQty, digits)}
    </span>
  );

  const columns: DataColumn<PurchaseOrderRow>[] = [
    {
      key: 'number',
      header: 'الرقم',
      cell: (r) => (
        <div className="flex flex-col items-start gap-1 py-2">
          <Link
            to={`/purchase-orders/${r.id}`}
            className="rounded-sm font-semibold text-ink underline decoration-transparent underline-offset-4 transition-[color,text-decoration-color] duration-120 ease-standard hover:text-brand-ink hover:decoration-current"
          >
            <bdi dir="ltr" className="num">
              {r.number}
            </bdi>
          </Link>
          {/* On a phone the supplier, the status and the progress sit under the number */}
          <span className="text-xs text-ink-muted sm:hidden">{r.supplierName}</span>
          <span className="flex flex-wrap items-center gap-2 sm:hidden">
            <Badge tone={ORDER_TONES[r.status]}>{PURCHASE_ORDER_STATUS_LABELS[r.status]}</Badge>
            {progress(r)}
          </span>
        </div>
      ),
    },
    { key: 'supplier', header: 'المورد', className: 'hidden sm:table-cell', cell: (r) => r.supplierName },
    {
      key: 'date',
      header: 'التاريخ',
      className: 'hidden md:table-cell',
      cell: (r) => <span className="whitespace-nowrap">{dayText(r.date, digits)}</span>,
    },
    {
      key: 'expected',
      header: 'التسليم المتوقع',
      className: 'hidden lg:table-cell',
      cell: (r) =>
        r.expectedDate ? <span className="whitespace-nowrap">{dayText(r.expectedDate, digits)}</span> : '—',
    },
    {
      key: 'received',
      header: 'المستلم',
      className: 'hidden sm:table-cell',
      cell: progress,
    },
    {
      key: 'total',
      header: 'المجموع',
      numeric: true,
      cell: (r) => <Money minor={r.totalMinor} currency={base} />,
    },
    {
      key: 'status',
      header: 'الحالة',
      className: 'hidden sm:table-cell',
      cell: (r) => <Badge tone={ORDER_TONES[r.status]}>{PURCHASE_ORDER_STATUS_LABELS[r.status]}</Badge>,
    },
  ];

  return (
    <ReportScreen me={me} access={['purchases.manage']} title="طلبيات الشراء">
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="طلبيات الشراء"
          description="اطلب من مورّدك ما ينقص، وتابع ما وصل منه. الطلبية وعد فقط: لا تسجّل شراءً ولا تدخل المخزون."
          icon={<ListIcon />}
          actions={
            <Button icon={<AddIcon />} onClick={() => void navigate('/purchase-orders/new')}>
              طلبية جديدة
            </Button>
          }
        />
        <div className="max-w-full min-w-0 overflow-x-auto">
          <SegmentedControl label="حالة الطلبية" value={status} onValueChange={setStatus} options={FILTERS} />
        </div>
        <DataTable
          caption="طلبيات الشراء"
          columns={columns}
          rows={rows ?? []}
          rowKey={(r) => r.id}
          loading={rows === null && !error}
          {...(error ? { error, onRetry: load } : {})}
          empty={
            <EmptyState
              icon={ListIcon}
              title="لا طلبيات شراء هنا"
              description="اضغط «طلبية جديدة»، أو اختر مورداً واضغط «اقترح طلبية» ليجمع لك ما نقص عنده."
            />
          }
        />
      </div>
    </ReportScreen>
  );
}
