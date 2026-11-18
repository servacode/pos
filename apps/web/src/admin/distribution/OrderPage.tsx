import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { salesOrderOpen, type PickingList, type SalesOrderRow } from '@serva/core';
import {
  Alert,
  BackIcon,
  Button,
  Card,
  CardHeader,
  DataTable,
  Dialog,
  Money,
  PageHeader,
  PrintIcon,
  Select,
  Skeleton,
  TextField,
  TruckIcon,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { ApiError, errorMessage } from '../../lib/api';
import { PrintSheet, usePrint } from '../../lib/print';
import { assignOrder, cancelOrder, getOrder, getPickingList, listVans } from './api';
import { OrderBadge, PickingSheet } from './OrdersPage';
import { FormFooter, qtyOf, useLoad } from './parts';

type Line = SalesOrderRow['lines'][number];

function CancelDialog({
  order,
  onDone,
  onCancel,
}: {
  order: SalesOrderRow;
  onDone: (o: SalesOrderRow) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setFields({});
    try {
      onDone(await cancelOrder(order.id, { reason, version: order.version }));
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      else setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={`إلغاء الطلبية ${order.number}`}
      description="ما بقي منها يتحرر من الحجز. ما سُلِّم وفُوتر قبلاً يبقى كما هو."
    >
      <form
        aria-label="إلغاء الطلبية"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <TextField
          label="سبب الإلغاء"
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={fields.reason}
        />
        <FormFooter>
          <Button variant="secondary" onClick={onCancel}>
            تراجع
          </Button>
          <Button type="submit" variant="danger" loading={saving}>
            ألغِ الطلبية
          </Button>
        </FormFooter>
      </form>
    </Dialog>
  );
}

function AssignDialog({
  order,
  onDone,
  onCancel,
}: {
  order: SalesOrderRow;
  onDone: (o: SalesOrderRow) => void;
  onCancel: () => void;
}) {
  const me = useMe();
  const vans = useLoad(listVans);
  const places = [
    ...me.branches.map((b) => ({ id: b.id, name: b.name })),
    ...(vans.data ?? []).filter((v) => v.isActive).map((v) => ({ id: v.id, name: `${v.name} (سيارة)` })),
  ];
  const [placeId, setPlaceId] = useState(order.warehouseBranchId);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      onDone(await assignOrder(order.id, { warehouseBranchId: placeId, version: order.version }));
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={`إرسال ${order.number}`}
      description="تُجهَّز الطلبية من هذا المكان، وتظهر في يوم مندوب السيارة."
    >
      <form
        aria-label="إرسال الطلبية"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Select label="تُجهَّز من" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <FormFooter>
          <Button variant="secondary" onClick={onCancel}>
            تراجع
          </Button>
          <Button type="submit" loading={saving} disabled={placeId === order.warehouseBranchId}>
            أرسل
          </Button>
        </FormFooter>
      </form>
    </Dialog>
  );
}

/** One order: its lines with what is delivered, and the supervisor's moves: print, send to a van, cancel */
export function OrderPage() {
  const { id = '' } = useParams();
  const [order, setOrder] = useState<SalesOrderRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'assign' | 'cancel' | null>(null);
  const [sheet, setSheet] = useState<PickingList | null>(null);
  const { paper, print } = usePrint();

  useEffect(() => {
    getOrder(id)
      .then(setOrder)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  if (!order) return error ? <Alert tone="error">{error}</Alert> : <Skeleton className="h-40 w-full" />;
  const open = salesOrderOpen(order.status) || order.status === 'expired';

  async function printPicking() {
    if (!order) return;
    try {
      setSheet(await getPickingList(order.warehouseBranchId, [order.id]));
      print('A4');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const columns: DataColumn<Line>[] = [
    { key: 'name', header: 'الصنف', cell: (l) => <span className="font-semibold">{l.name}</span> },
    { key: 'qty', header: 'المطلوب', numeric: true, cell: (l) => qtyOf(l.qty) },
    { key: 'done', header: 'سُلِّم', numeric: true, cell: (l) => qtyOf(l.deliveredQty) },
    {
      key: 'left',
      header: 'المتبقي',
      numeric: true,
      cell: (l) => qtyOf(Math.max(0, l.qty - l.deliveredQty)),
    },
    {
      key: 'price',
      header: 'السعر',
      numeric: true,
      className: 'hidden sm:table-cell',
      cell: (l) => <Money minor={l.unitPriceMinor} currency={order.currency} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={`الطلبية ${order.number}`}
        description={
          <>
            {order.customerName} · <bdi className="num">{order.businessDate}</bdi>
          </>
        }
        icon={<TruckIcon />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <OrderBadge status={order.status} />
            <Link to="/distribution/orders">
              <Button variant="secondary" icon={<BackIcon />}>
                كل الطلبيات
              </Button>
            </Link>
          </div>
        }
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <DataTable caption="بنود الطلبية" columns={columns} rows={order.lines} rowKey={(l) => l.variantId} />
        <Card>
          <CardHeader title="التفاصيل" />
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">المجموع</dt>
              <dd className="font-semibold">
                <Money minor={order.totalMinor} currency={order.currency} />
              </dd>
            </div>
            {order.depositMinor > 0 ? (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">عربون</dt>
                <dd>
                  <Money minor={order.depositMinor} currency={order.currency} />
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">المندوب</dt>
              <dd>{order.repName ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">تُجهَّز من</dt>
              <dd>{order.warehouseName}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">موعد التسليم</dt>
              <dd>{order.deliveryDate ? <bdi className="num">{order.deliveryDate}</bdi> : '—'}</dd>
            </div>
            {order.holdUntil && open ? (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">تُحجز حتى</dt>
                <dd>
                  <bdi className="num">{order.holdUntil.slice(0, 10)}</bdi>
                </dd>
              </div>
            ) : null}
            {order.note ? <p className="rounded-control bg-surface-muted p-3">{order.note}</p> : null}
            {order.cancelReason ? <Alert tone="warning">سبب الإلغاء: {order.cancelReason}</Alert> : null}
          </dl>
          <div className="mt-4 flex flex-col gap-2">
            <Button variant="secondary" icon={<PrintIcon />} onClick={() => void printPicking()}>
              اطبع قائمة التجهيز
            </Button>
            {open && order.status !== 'expired' ? (
              <>
                <Button variant="secondary" onClick={() => setDialog('assign')}>
                  أرسلها إلى سيارة
                </Button>
                <Button variant="ghost" onClick={() => setDialog('cancel')}>
                  ألغِ الطلبية
                </Button>
              </>
            ) : null}
            {open && order.status === 'expired' ? (
              <Button variant="ghost" onClick={() => setDialog('cancel')}>
                ألغِ الطلبية
              </Button>
            ) : null}
          </div>
          <p className="mt-4 text-xs text-ink-muted">
            تُفوتَر الطلبية بفاتورة بيع عادية تذكرها عند التسليم، فتُسجَّل ماليّاً وتخرج من المخزون وقتها فقط.
          </p>
        </Card>
      </div>
      {dialog === 'assign' ? (
        <AssignDialog
          order={order}
          onCancel={() => setDialog(null)}
          onDone={(o) => {
            setOrder(o);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === 'cancel' ? (
        <CancelDialog
          order={order}
          onCancel={() => setDialog(null)}
          onDone={(o) => {
            setOrder(o);
            setDialog(null);
          }}
        />
      ) : null}
      {paper && sheet ? (
        <PrintSheet paper={paper}>
          <PickingSheet list={sheet} />
        </PrintSheet>
      ) : null}
    </>
  );
}
