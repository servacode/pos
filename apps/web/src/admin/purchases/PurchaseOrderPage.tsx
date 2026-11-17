import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  formatMoney,
  orderLineCost,
  orderLineRemaining,
  PURCHASE_ORDER_NEXT,
  PURCHASE_ORDER_STATUS_LABELS,
  purchaseOrderOpen,
  purchaseOrderText,
  type PurchaseOrderDetail,
  type PurchaseOrderLine,
  type StoreResponse,
} from '@serva/core';
import { normalizePhone } from '@serva/core/phone';
import {
  Alert,
  BackIcon,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  Dialog,
  formatQuantity,
  ListIcon,
  Money,
  PageHeader,
  PrintIcon,
  ProgressBar,
  SkeletonText,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { PurchaseOrderA4 } from '../../lib/a4/documents';
import { ReportScreen } from '../reports/parts';
import { errorMessage } from '../../lib/api';
import { dayText } from '../../lib/dates';
import { PrintSheet, usePrint } from '../../lib/print';
import { getStore } from '../store/api';
import { today } from './api';
import { getOrder, moveOrder } from './orderApi';
import { ORDER_TONES } from './PurchaseOrdersPage';

/** The wa.me address to chat with a supplier, or the plain one that lets the owner pick a contact */
export function orderWhatsappLink(phone: string | null, text: string): string {
  const normal = phone ? normalizePhone(phone) : null;
  return `https://wa.me/${normal ? normal.replace('+', '') : ''}?text=${encodeURIComponent(text)}`;
}

/**
 * One purchase order: its lines with how much of each has arrived, its receipts, and the steps
 * (send on WhatsApp, print on A4, receive the goods, close it short, cancel it). Receiving opens the
 * ordinary purchase form filled with what is still owed: the order itself posts and moves nothing.
 */
export function PurchaseOrderPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const digits = useDigits();
  const navigate = useNavigate();
  const { paper, print } = usePrint();
  const base = me.settings.baseCurrency;
  const [order, setOrder] = useState<PurchaseOrderDetail | null>(null);
  const [store, setStore] = useState<StoreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Asked after WhatsApp opens («هل أُرسلت؟») and before an order is closed short
  const [asking, setAsking] = useState<'sent' | 'close' | null>(null);

  useEffect(() => {
    getOrder(id)
      .then(setOrder)
      .catch((e: unknown) => setError(errorMessage(e)));
    void getStore().then(setStore, () => undefined);
  }, [id]);

  async function step(to: 'sent' | 'received' | 'cancelled', message: string) {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      setOrder(await moveOrder(order.id, to, order.version));
      setNotice(message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /** The chat opens first (a browser blocks a window opened after a wait), then a draft is marked sent */
  function sendOnWhatsapp() {
    if (!order) return;
    const text = purchaseOrderText(
      order,
      store?.name ?? me.tenant.name,
      (q) => formatQuantity(q, digits),
      (d) => dayText(d, digits),
      (m) => formatMoney(m, base, { digits }),
    );
    window.open(orderWhatsappLink(order.supplierPhone, text), '_blank', 'noopener');
    // The window opening does not mean the message went: a draft is marked sent only when the owner says so
    if (order.status === 'draft') setAsking('sent');
  }

  const next = order ? PURCHASE_ORDER_NEXT[order.status] : [];
  const open = order ? purchaseOrderOpen(order.status) : false;
  const percent =
    order && order.orderedQty > 0 ? Math.round((order.receivedQty / order.orderedQty) * 100) : 0;
  const doneLines = order ? order.lines.filter((l) => orderLineRemaining(l) === 0).length : 0;
  const late = Boolean(order && open && order.expectedDate && order.expectedDate < today());

  const columns: DataColumn<PurchaseOrderLine>[] = [
    { key: 'name', header: 'الصنف', cell: (l) => <span className="font-semibold">{l.name}</span> },
    {
      key: 'qty',
      header: 'المطلوب',
      numeric: true,
      cell: (l) => <span className="num">{formatQuantity(l.qty, digits)}</span>,
    },
    {
      key: 'got',
      header: 'المستلم',
      numeric: true,
      cell: (l) => {
        const left = orderLineRemaining(l);
        const share = l.qty > 0 ? Math.min(100, Math.round((l.receivedQty / l.qty) * 100)) : 0;
        return (
          <span className="flex min-w-16 flex-col items-end gap-1">
            <span className="num">{formatQuantity(l.receivedQty, digits)}</span>
            <ProgressBar
              value={share}
              label={`المستلم من ${l.name} ${String(share)}٪`}
              tone={left === 0 ? 'success' : 'brand'}
              className="h-1"
            />
          </span>
        );
      },
    },
    {
      key: 'left',
      header: 'الباقي',
      numeric: true,
      cell: (l) => {
        const left = orderLineRemaining(l);
        return left === 0 ? (
          <Badge tone="success">وصل</Badge>
        ) : (
          <span className="num font-semibold">{formatQuantity(left, digits)}</span>
        );
      },
    },
    {
      key: 'unit',
      header: 'سعر الوحدة',
      numeric: true,
      className: 'hidden sm:table-cell',
      cell: (l) => <Money minor={l.unitCostMinor} currency={base} />,
    },
    {
      key: 'cost',
      header: 'المجموع',
      numeric: true,
      cell: (l) => <Money minor={orderLineCost(l.unitCostMinor, l.qty)} currency={base} />,
    },
  ];

  return (
    <ReportScreen
      me={me}
      access={['purchases.manage']}
      title={order ? `طلبية ${order.number}` : 'طلبية شراء'}
    >
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title={
            order ? (
              <span className="flex flex-wrap items-center gap-3">
                <bdi dir="ltr" className="num">
                  {order.number}
                </bdi>
                <Badge tone={ORDER_TONES[order.status]}>{PURCHASE_ORDER_STATUS_LABELS[order.status]}</Badge>
              </span>
            ) : (
              'طلبية شراء'
            )
          }
          description={order ? `إلى ${order.supplierName}` : undefined}
          icon={<ListIcon />}
          actions={
            <Link
              to="/purchase-orders"
              className="inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-brand-ink hover:underline"
            >
              <BackIcon size={16} className="rotate-180" />
              كل الطلبيات
            </Link>
          }
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {!order && !error ? <SkeletonText lines={5} /> : null}
        {order ? (
          <>
            <Card>
              <CardHeader
                title="الاستلام"
                description="يزيد المستلم كلما سجّلت فاتورة شراء من هذه الطلبية."
              />
              <div className="flex flex-col gap-3">
                <ProgressBar value={percent} label={`المستلم من الطلبية ${String(percent)}٪`} />
                <p className="text-sm text-ink-muted">
                  وصل{' '}
                  <span className="num font-semibold text-ink">
                    {formatQuantity(doneLines * 1000, digits)}
                  </span>{' '}
                  من{' '}
                  <span className="num font-semibold text-ink">
                    {formatQuantity(order.lines.length * 1000, digits)}
                  </span>{' '}
                  أسطر · القطع{' '}
                  <span className="num font-semibold text-ink">
                    {formatQuantity(order.receivedQty, digits)}
                  </span>{' '}
                  من{' '}
                  <span className="num font-semibold text-ink">
                    {formatQuantity(order.orderedQty, digits)}
                  </span>
                  {order.expectedDate ? <> · التسليم المطلوب {dayText(order.expectedDate, digits)}</> : null}
                  {late ? (
                    <>
                      {' '}
                      <Badge tone="danger">متأخرة</Badge>
                    </>
                  ) : null}
                  {' · '}المجموع المتوقع{' '}
                  <Money minor={order.totalMinor} currency={base} className="font-semibold text-ink" />
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {open ? (
                    <Button onClick={() => void navigate(`/purchases?order=${order.id}`)}>
                      استلم البضاعة
                    </Button>
                  ) : null}
                  {order.status === 'draft' || open ? (
                    <Button variant="secondary" onClick={sendOnWhatsapp} loading={busy}>
                      {order.status === 'draft' ? 'أرسلها على واتساب' : 'أعد إرسالها على واتساب'}
                    </Button>
                  ) : null}
                  {order.status === 'draft' ? (
                    <Button
                      variant="secondary"
                      onClick={() => void step('sent', 'عُلّمت الطلبية مُرسلة.')}
                      disabled={busy}
                    >
                      علّمها مُرسلة
                    </Button>
                  ) : null}
                  {order.status === 'draft' || order.status === 'sent' ? (
                    <Button
                      variant="secondary"
                      onClick={() => void navigate(`/purchase-orders/${order.id}/edit`)}
                    >
                      عدّل
                    </Button>
                  ) : null}
                  <Button variant="secondary" icon={<PrintIcon />} onClick={() => print('A4')}>
                    اطبع A4
                  </Button>
                  {next.includes('received') ? (
                    <Button variant="ghost" disabled={busy} onClick={() => setAsking('close')}>
                      أغلقها بما وصل
                    </Button>
                  ) : null}
                  {next.includes('cancelled') ? (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void step('cancelled', 'أُلغيت الطلبية.')}
                    >
                      ألغِ الطلبية
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
            {asking === 'sent' ? (
              <Dialog
                open
                onOpenChange={(o) => {
                  if (!o) setAsking(null);
                }}
                title="هل أُرسلت الطلبية؟"
                description="فتحنا واتساب. علّمها مُرسلة فقط إن أرسلت الرسالة فعلاً."
              >
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => {
                      setAsking(null);
                      void step('sent', 'عُلّمت الطلبية مُرسلة.');
                    }}
                  >
                    نعم، أُرسلت
                  </Button>
                  <Button variant="secondary" onClick={() => setAsking(null)}>
                    لا
                  </Button>
                </div>
              </Dialog>
            ) : null}
            {asking === 'close' ? (
              <Dialog
                open
                onOpenChange={(o) => {
                  if (!o) setAsking(null);
                }}
                title="إغلاق الطلبية بما وصل؟"
                description={`وصل ${formatQuantity(order.receivedQty, digits)} من ${formatQuantity(order.orderedQty, digits)}. ما لم يصل لن يبقى منتظَراً على هذه الطلبية.`}
              >
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => {
                      setAsking(null);
                      void step('received', 'أُغلقت الطلبية ناقصة بما وصل.');
                    }}
                  >
                    نعم، أغلقها
                  </Button>
                  <Button variant="secondary" onClick={() => setAsking(null)}>
                    لا، أبقها مفتوحة
                  </Button>
                </div>
              </Dialog>
            ) : null}
            <DataTable
              caption="أصناف الطلبية"
              columns={columns}
              rows={order.lines}
              rowKey={(l) => String(l.lineNo)}
            />
            {order.notes ? (
              <Card>
                <CardHeader title="ملاحظات" />
                <p className="whitespace-pre-line text-ink">{order.notes}</p>
              </Card>
            ) : null}
            {order.receipts.length > 0 ? (
              <Card>
                <CardHeader
                  title="فواتير الاستلام"
                  description="كل استلام فاتورة شراء عادية دخلت بها البضاعة المخزون."
                />
                <ul aria-label="فواتير الاستلام" className="flex flex-col gap-2">
                  {order.receipts.map((r) => (
                    <li key={r.purchaseId} className="flex flex-wrap items-center gap-3">
                      <Link
                        to={`/purchases?q=${r.number}`}
                        className="rounded-sm font-semibold text-brand-ink hover:underline"
                      >
                        <bdi dir="ltr" className="num">
                          {r.number}
                        </bdi>
                      </Link>
                      <span className="text-sm text-ink-muted">{dayText(r.date, digits)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </>
        ) : null}
        {paper === 'A4' && order && store ? (
          <PrintSheet paper="A4">
            <PurchaseOrderA4
              order={order}
              store={{
                name: store.name,
                taxNumber: store.taxNumber,
                branchName: null,
                address: store.address,
                phone: store.phone,
                footer: null,
              }}
            />
          </PrintSheet>
        ) : null}
      </div>
    </ReportScreen>
  );
}
