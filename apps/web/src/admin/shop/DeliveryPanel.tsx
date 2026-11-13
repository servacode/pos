import { useCallback, useEffect, useState } from 'react';
import type { CodSummary, OnlineOrder } from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CheckIcon,
  EmptyState,
  Money,
  PrintIcon,
  SkeletonText,
  TextField,
  TruckIcon,
} from '@serva/ui';
import { apiFetch, errorMessage } from '../../lib/api';
import { PrintSheet, usePrint } from '../../lib/print';

/**
 * «التوصيل» (26 › حياة الطلب): a delivery order goes out with a courier's name, then is delivered;
 * its slip prints for the courier with what to collect; and a card lists, per courier, the orders
 * still out and the cash each is expected to bring back. The stage posts nothing: the money is the
 * till sale's, as for any order.
 */

const setDelivery = (order: OnlineOrder, body: { stage: 'out'; courier: string } | { stage: 'delivered' }) =>
  apiFetch<OnlineOrder>(`/v1/online-orders/${order.id}/delivery`, {
    method: 'POST',
    body: { ...body, version: order.version },
    auth: true,
  });

const getCod = () => apiFetch<CodSummary>('/v1/online-orders/cod', { auth: true });

/** When the order's stage was set, short: «2026-11-13 14:30» of the browser's clock */
const stamp = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');

/** What the courier takes from the customer: the pieces and his own fee */
export const collectOf = (o: Pick<OnlineOrder, 'totalMinor' | 'deliveryFeeMinor'>) =>
  o.totalMinor + o.deliveryFeeMinor;

/** The courier's slip: who, where, what and how much to collect, on A5-ish paper */
export function DeliverySlip({ order, store }: { order: OnlineOrder; store: string }) {
  return (
    <section dir="rtl" className="mx-auto flex w-full max-w-[148mm] flex-col gap-3 p-6 text-ink">
      <header className="flex items-baseline justify-between gap-3 border-b-2 border-ink pb-2">
        <h1 className="text-xl font-bold">ورقة توصيل · {store}</h1>
        <bdi dir="ltr" className="num text-lg font-bold">
          {order.number}
        </bdi>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-base">
        <dt className="font-bold">الزبون</dt>
        <dd>{order.customerName}</dd>
        <dt className="font-bold">الجوال</dt>
        <dd>
          <bdi dir="ltr" className="num">
            {order.phone}
          </bdi>
        </dd>
        {order.deliveryArea ? (
          <>
            <dt className="font-bold">المنطقة</dt>
            <dd>{order.deliveryArea}</dd>
          </>
        ) : null}
        <dt className="font-bold">العنوان</dt>
        <dd className="whitespace-pre-line">{order.address ?? '—'}</dd>
        {order.courierName ? (
          <>
            <dt className="font-bold">المندوب</dt>
            <dd>{order.courierName}</dd>
          </>
        ) : null}
      </dl>
      <table className="w-full border-collapse text-base">
        <thead>
          <tr className="border-y border-ink text-start">
            <th className="py-1 text-start">القطعة</th>
            <th className="py-1 text-end">الكمية</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l) => (
            <tr key={l.variantId} className="border-b border-dashed border-ink">
              <td className="py-1">
                {l.name}
                {l.label ? ` (${l.label})` : ''}
              </td>
              <td className="num py-1 text-end">{l.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {order.note ? <p className="text-sm">ملاحظة الزبون: {order.note}</p> : null}
      <div className="flex items-baseline justify-between gap-3 border-t-2 border-ink pt-2 text-lg font-bold">
        <span>المبلغ المطلوب تحصيله</span>
        <Money minor={collectOf(order)} currency={order.currency} />
      </div>
      {order.deliveryFeeMinor > 0 ? (
        <p className="text-sm">
          منه أجرة التوصيل <Money minor={order.deliveryFeeMinor} currency={order.currency} />.
        </p>
      ) : null}
      <p className="mt-6 text-sm">توقيع المستلم: ______________________</p>
    </section>
  );
}

/** The order's delivery controls: out with a courier, delivered, and the slip */
export function DeliveryActions({
  order,
  store,
  onChanged,
}: {
  order: OnlineOrder;
  store: string;
  onChanged: () => void;
}) {
  const [courier, setCourier] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slip = usePrint();

  async function run(body: Parameters<typeof setDelivery>[1]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setDelivery(order, body);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
    onChanged();
  }

  const stage = order.deliveryStage ?? null;
  return (
    <div
      role="group"
      aria-label={`التوصيل ${order.number}`}
      className="flex flex-col gap-3 rounded-control border border-line bg-surface-muted/50 p-3"
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap items-end gap-2">
        {stage === null ? (
          <>
            <div className="min-w-40 flex-1">
              <TextField
                label="اسم المندوب"
                value={courier}
                onChange={(e) => setCourier(e.target.value.slice(0, 60))}
              />
            </div>
            <Button
              size="sm"
              icon={<TruckIcon size={16} />}
              loading={busy}
              disabled={!courier.trim()}
              onClick={() => void run({ stage: 'out', courier })}
            >
              خرج للتوصيل
            </Button>
          </>
        ) : stage === 'out' ? (
          <>
            <p className="min-w-0 flex-1 text-sm text-ink">
              <Badge tone="info">خرج للتوصيل</Badge> مع{' '}
              <span className="font-semibold">{order.courierName}</span>
              <span className="num text-ink-muted"> · {stamp(order.outAt)}</span>
            </p>
            <Button
              size="sm"
              icon={<CheckIcon size={16} />}
              loading={busy}
              onClick={() => void run({ stage: 'delivered' })}
            >
              سُلّم
            </Button>
          </>
        ) : (
          <p className="min-w-0 flex-1 text-sm text-ink">
            <Badge tone="success">سُلّم</Badge>
            {order.courierName ? ` بيد ${order.courierName}` : ''}
            <span className="num text-ink-muted"> · {stamp(order.deliveredAt)}</span>
          </p>
        )}
        <Button size="sm" variant="secondary" icon={<PrintIcon size={16} />} onClick={() => slip.print('A4')}>
          اطبع ورقة التوصيل
        </Button>
      </div>
      {slip.paper ? (
        <PrintSheet paper="A4">
          <DeliverySlip order={order} store={store} />
        </PrintSheet>
      ) : null}
    </div>
  );
}

/** «النقد مع المندوبين»: the orders out for delivery, by courier, and the cash each should bring back */
export function CodCard({ refreshKey }: { refreshKey: number }) {
  const [cod, setCod] = useState<CodSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    getCod()
      .then(setCod)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  // The orders box above reloads after any change: so does this card
  useEffect(load, [load, refreshKey]);

  return (
    <Card>
      <CardHeader
        icon={<TruckIcon />}
        title="النقد مع المندوبين"
        description="الطلبات التي خرجت للتوصيل ولم تُسلَّم بعد، والمبلغ المنتظَر من كل مندوب."
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!cod && !error ? <SkeletonText lines={3} /> : null}
      {cod && cod.couriers.length === 0 ? (
        <EmptyState
          icon={TruckIcon}
          title="لا طلبات عند المندوبين الآن."
          description="يظهر الطلب هنا حين تضغط «خرج للتوصيل»، ويغيب حين تضغط «سُلّم»."
        />
      ) : null}
      {cod && cod.couriers.length > 0 ? (
        <ul aria-label="المندوبون" className="flex flex-col gap-4">
          {cod.couriers.map((c) => (
            <li
              key={c.courier}
              aria-label={`المندوب ${c.courier}`}
              className="flex flex-col gap-2 rounded-control border border-line p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-bold text-ink">{c.courier}</h3>
                <p className="text-sm text-ink-muted">
                  المنتظَر منه{' '}
                  <Money minor={c.expectedMinor} currency={cod.currency} className="font-bold text-ink" />
                </p>
              </div>
              <ul className="flex flex-col divide-y divide-line text-sm">
                {c.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <bdi dir="ltr" className="num font-semibold">
                        {o.number}
                      </bdi>{' '}
                      · {o.customerName}
                      {o.deliveryArea ? ` · ${o.deliveryArea}` : ''}
                    </span>
                    <Money minor={o.collectMinor} currency={cod.currency} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
