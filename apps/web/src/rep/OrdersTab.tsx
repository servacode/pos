import { useMemo } from 'react';
import { lineRemaining, type SalesOrderPullRow } from '@serva/core/distribution';
import { Alert, Badge, EmptyState, Money, PackageOpenIcon } from '@serva/ui';
import type { Catalog } from '../pos/catalog';
import { useRepRequired } from './state';

/**
 * «الطلبيات»: the pre-sale orders of this rep's van, the ones to deliver from the van (the
 * supervisor sent them here, or he took them and the van fills them) and the ones he took that
 * the warehouse fills. Delivering one is done on the customer's page.
 */
export function OrdersTab({
  catalog,
  vanBranchId,
  onOpenCustomer,
}: {
  catalog: Catalog;
  vanBranchId: string | null;
  onOpenCustomer: (customerId: string) => void;
}) {
  const rep = useRepRequired();
  const names = useMemo(() => new Map(catalog.customers.map((c) => [c.id, c.name])), [catalog.customers]);
  const open = rep.orders.filter((o) => o.status === 'open' || o.status === 'partial');
  const toDeliver = open.filter((o) => vanBranchId !== null && o.warehouseBranchId === vanBranchId);
  const waiting = open.filter((o) => vanBranchId === null || o.warehouseBranchId !== vanBranchId);

  const orderRow = (o: SalesOrderPullRow) => (
    <>
      <PackageOpenIcon className="shrink-0 text-ink-muted" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold text-ink">{names.get(o.customerId) ?? '—'}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <bdi dir="ltr" className="num">
            {o.number}
          </bdi>
          <span>{o.lines.filter((l) => lineRemaining(l) > 0).length} صنف</span>
          {o.deliveryDate ? <bdi dir="ltr">{o.deliveryDate}</bdi> : null}
        </span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <Money minor={o.totalMinor} currency={o.currency as never} className="text-sm font-semibold" />
        {o.status === 'partial' ? <Badge tone="warning">جزئي</Badge> : null}
      </span>
    </>
  );

  const list = (orders: SalesOrderPullRow[], deliver: boolean) => (
    <ul className="flex flex-col gap-2">
      {orders.map((o) => (
        <li key={o.id}>
          {deliver ? (
            <button
              type="button"
              onClick={() => onOpenCustomer(o.customerId)}
              className="flex min-h-16 w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-start hover:bg-surface-muted"
            >
              {orderRow(o)}
            </button>
          ) : (
            <div className="flex min-h-16 w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-start">
              {orderRow(o)}
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-4">
      {rep.pendingOrders > 0 ? (
        <Alert tone="info">{rep.pendingOrders} طلبية محفوظة على الجهاز وتُرسل عند عودة الاتصال.</Alert>
      ) : null}
      {open.length === 0 ? (
        <EmptyState
          icon={PackageOpenIcon}
          title="لا طلبيات مفتوحة."
          description="الطلبيات التي تأخذها من زبون، أو يرسلها لك المشرف، تظهر هنا."
        />
      ) : null}
      {toDeliver.length > 0 ? (
        <section aria-label="للتسليم من سيارتك" className="flex flex-col gap-2">
          <h3 className="text-sm font-bold text-ink">للتسليم من سيارتك</h3>
          {list(toDeliver, true)}
        </section>
      ) : null}
      {waiting.length > 0 ? (
        <section aria-label="تنتظر التجهيز" className="flex flex-col gap-2">
          <h3 className="text-sm font-bold text-ink">أخذتها وتنتظر التجهيز</h3>
          {list(waiting, false)}
        </section>
      ) : null}
    </div>
  );
}
