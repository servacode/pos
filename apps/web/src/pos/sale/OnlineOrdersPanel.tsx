import type { CurrencyCode } from '@serva/core';
import type { OnlineOrderRow } from '@serva/core/contracts/shop';
import { Button, CloseIcon, Money } from '@serva/ui';

/**
 * «طلبات المتجر» at the till (26 › حياة الطلب): the shop orders the store accepted, newest last.
 * Opening one puts its pieces in the cart; paying for it closes the order.
 */
export function OnlineOrdersPanel({
  orders,
  onOpen,
  onClose,
}: {
  orders: readonly OnlineOrderRow[];
  onOpen: (order: OnlineOrderRow) => void;
  onClose: () => void;
}) {
  return (
    <section
      aria-label="طلبات المتجر"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-ink">طلبات المتجر</h2>
        <Button variant="secondary" icon={<CloseIcon />} onClick={onClose}>
          أغلق
        </Button>
      </div>
      {orders.length === 0 ? (
        <p className="text-ink-muted">لا طلبات مقبولة تنتظر البيع.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((o) => (
            <li
              key={o.id}
              aria-label={`الطلب ${o.number}`}
              className="flex flex-wrap items-center gap-3 rounded-control border border-line p-3"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-bold">
                  <bdi dir="ltr" className="num">
                    {o.number}
                  </bdi>{' '}
                  · {o.customerName}
                </span>
                <span className="text-sm text-ink-muted">
                  {o.lines.map((l) => `${l.name}${l.label ? ` (${l.label})` : ''} × ${l.qty}`).join('، ')}
                </span>
                <span className="text-sm text-ink-muted">
                  {o.fulfilment === 'delivery' ? `توصيل إلى ${o.address ?? ''}` : 'استلام من المحل'}
                  {o.note ? ` · ${o.note}` : ''}
                </span>
              </span>
              <Money minor={o.totalMinor} currency={o.currency as CurrencyCode} className="font-bold" />
              <Button onClick={() => onOpen(o)}>افتح في السلة</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
