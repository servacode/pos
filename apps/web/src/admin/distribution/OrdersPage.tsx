import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  SALES_ORDER_STATUS_LABELS,
  type PickingList,
  type SalesOrderRow,
  type SalesOrderStatus,
  type VanRow,
} from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Money,
  PageHeader,
  PrintIcon,
  SearchField,
  SegmentedControl,
  Select,
  Skeleton,
  TruckIcon,
  type BadgeTone,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import { PrintSheet, usePrint } from '../../lib/print';
import { getPickingList, listOrders, listVans } from './api';
import { qtyOf, useLoad } from './parts';

export const ORDER_TONE: Record<SalesOrderStatus, BadgeTone> = {
  open: 'info',
  partial: 'warning',
  delivered: 'success',
  cancelled: 'neutral',
  expired: 'danger',
};

export const OrderBadge = ({ status }: { status: SalesOrderStatus }) => (
  <Badge tone={ORDER_TONE[status]}>{SALES_ORDER_STATUS_LABELS[status]}</Badge>
);

/** The sheet the store keeper takes to the shelves: what to pull, how much is there, and for whom */
export function PickingSheet({ list }: { list: PickingList }) {
  return (
    <div dir="rtl" className="text-ink" style={{ fontSize: '12pt' }}>
      <h1 style={{ fontSize: '16pt', fontWeight: 700, marginBottom: '4pt' }}>
        قائمة التجهيز · {list.warehouseName}
      </h1>
      <p style={{ marginBottom: '8pt' }}>
        الطلبيات: {list.orders.map((o) => `${o.number} (${o.customerName})`).join('، ') || '—'}
      </p>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {['الصنف', 'المطلوب', 'المتوفر', 'تم'].map((h) => (
              <th key={h} style={{ border: '1px solid #000', padding: '4pt', textAlign: 'start' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.items.map((item) => (
            <tr key={item.variantId}>
              <td style={{ border: '1px solid #000', padding: '4pt' }}>{item.name}</td>
              <td style={{ border: '1px solid #000', padding: '4pt' }}>{qtyOf(item.qty)}</td>
              <td style={{ border: '1px solid #000', padding: '4pt' }}>
                {qtyOf(item.onHand)}
                {item.onHand < item.qty ? ' (ناقص)' : ''}
              </td>
              <td style={{ border: '1px solid #000', padding: '4pt', width: '12%' }} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** «قائمة التجهيز»: pick a place (a branch or a van) and print what its open orders need */
function PickingDialog({ vans, onClose }: { vans: readonly VanRow[]; onClose: () => void }) {
  const me = useMe();
  const places = [
    ...me.branches.map((b) => ({ id: b.id, name: b.name })),
    ...vans.filter((v) => v.isActive).map((v) => ({ id: v.id, name: v.name })),
  ];
  const [placeId, setPlaceId] = useState(places[0]?.id ?? '');
  const [list, setList] = useState<PickingList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { paper, print } = usePrint();

  useEffect(() => {
    if (!placeId) return;
    setList(null);
    getPickingList(placeId)
      .then(setList)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [placeId]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="قائمة التجهيز"
      description="ما يُسحب من الرفوف لكل الطلبيات المفتوحة في هذا المكان."
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Select label="مكان التجهيز" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        {!list ? (
          <Skeleton className="h-20 w-full" />
        ) : list.items.length === 0 ? (
          <p className="py-3 text-center text-sm text-ink-muted">لا طلبيات مفتوحة هنا.</p>
        ) : (
          <ul className="flex max-h-72 flex-col divide-y divide-line overflow-auto">
            {list.items.map((item) => (
              <li key={item.variantId} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-semibold">{item.name}</span>
                <span className="num text-ink-muted">
                  {qtyOf(item.qty)} من {qtyOf(item.onHand)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            أغلق
          </Button>
          <Button
            icon={<PrintIcon />}
            disabled={!list || list.items.length === 0}
            onClick={() => print('A4')}
          >
            اطبع
          </Button>
        </div>
      </div>
      {paper && list ? (
        <PrintSheet paper={paper}>
          <PickingSheet list={list} />
        </PrintSheet>
      ) : null}
    </Dialog>
  );
}

type Filter = 'active' | 'delivered' | 'cancelled' | 'all';

/** «الطلبيات»: what reps promised customers, to follow, send to a van, and fill */
export function OrdersPage() {
  const [filter, setFilter] = useState<Filter>('active');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SalesOrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const vans = useLoad(listVans);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () => {
        listOrders({ ...(filter === 'all' ? {} : { status: filter }), ...(q.trim() ? { q: q.trim() } : {}) })
          .then((r) => {
            if (live) {
              setRows(r);
              setError(null);
            }
          })
          .catch((e: unknown) => live && setError(errorMessage(e)));
      },
      q ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [filter, q]);

  const columns: DataColumn<SalesOrderRow>[] = [
    {
      key: 'number',
      header: 'الطلبية',
      cell: (o) => (
        <div className="flex flex-col gap-0.5 py-2">
          <Link
            to={`/distribution/orders/${o.id}`}
            className="font-semibold underline-offset-4 hover:underline"
          >
            <bdi className="num">{o.number}</bdi>
          </Link>
          <span className="text-xs text-ink-muted">{o.customerName}</span>
        </div>
      ),
    },
    { key: 'rep', header: 'المندوب', className: 'hidden md:table-cell', cell: (o) => o.repName ?? '—' },
    { key: 'where', header: 'تُجهَّز من', className: 'hidden sm:table-cell', cell: (o) => o.warehouseName },
    {
      key: 'date',
      header: 'التسليم',
      className: 'hidden sm:table-cell',
      cell: (o) => (o.deliveryDate ? <bdi className="num">{o.deliveryDate}</bdi> : '—'),
    },
    {
      key: 'total',
      header: 'المبلغ',
      numeric: true,
      cell: (o) => <Money minor={o.totalMinor} currency={o.currency} />,
    },
    { key: 'status', header: 'الحالة', cell: (o) => <OrderBadge status={o.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="الطلبيات"
        description="طلبيات البيع المسبق: لا تُسجَّل مالياً حتى تُفوتَر عند التسليم."
        icon={<TruckIcon />}
        actions={
          <Button variant="secondary" icon={<PrintIcon />} onClick={() => setPicking(true)}>
            قائمة التجهيز
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<Filter>
          label="الحالة"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: 'active', label: 'مفتوحة' },
            { value: 'delivered', label: 'مسلّمة' },
            { value: 'cancelled', label: 'ملغاة' },
            { value: 'all', label: 'الكل' },
          ]}
        />
        <SearchField
          label="ابحث بالرقم أو الزبون"
          placeholder="رقم الطلبية أو اسم الزبون"
          value={q}
          onValueChange={setQ}
          className="min-w-56 flex-1 sm:max-w-sm"
        />
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <DataTable
        caption="الطلبيات"
        columns={columns}
        rows={rows ?? []}
        rowKey={(o) => o.id}
        loading={!rows && !error}
        empty={
          <EmptyState
            icon={TruckIcon}
            title="لا طلبيات هنا."
            description="تظهر هنا الطلبيات التي يأخذها المندوبون من زبائنهم."
          />
        }
      />
      {picking ? <PickingDialog vans={vans.data ?? []} onClose={() => setPicking(false)} /> : null}
    </>
  );
}
