import type { CurrencyCode } from '@serva/core';
import type { OnlineOrderRow } from '@serva/core/contracts/shop';
import { Button, CartIcon, CloseIcon, EmptyState, InboxIcon, Money } from '@serva/ui';
import { SalePanel } from './SalePanel';

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
    <SalePanel
      label="طلبات المتجر"
      title="طلبات المتجر"
      icon={<InboxIcon size={20} />}
      actions={
        <Button variant="secondary" size="md" icon={<CloseIcon size={20} />} onClick={onClose}>
          أغلق
        </Button>
      }
    >
      {orders.length === 0 ? (
        <EmptyState icon={InboxIcon} title="لا طلبات مقبولة تنتظر البيع." />
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((o) => (
            <li
              key={o.id}
              aria-label={`الطلب ${o.number}`}
              className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-e1"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <bdi dir="ltr" className="num font-bold text-ink">
                    {o.number}
                  </bdi>
                  <span className="font-semibold text-ink">· {o.customerName}</span>
                </span>
                <span className="text-sm text-ink-muted">
                  {o.lines.map((l) => `${l.name}${l.label ? ` (${l.label})` : ''} × ${l.qty}`).join('، ')}
                </span>
                <span className="text-sm text-ink-subtle">
                  {o.fulfilment === 'delivery' ? `توصيل إلى ${o.address ?? ''}` : 'استلام من المحل'}
                  {o.deliveryFeeMinor > 0 ? (
                    <>
                      {' '}
                      · أجرة التوصيل{' '}
                      <Money minor={o.deliveryFeeMinor} currency={o.currency as CurrencyCode} /> للمندوب
                    </>
                  ) : null}
                  {o.note ? ` · ${o.note}` : ''}
                </span>
                {o.fulfilment === 'delivery' ? (
                  <span className="text-sm text-ink-muted">
                    جوال الزبون:{' '}
                    <bdi dir="ltr" className="num font-semibold text-ink">
                      {o.phone}
                    </bdi>
                  </span>
                ) : null}
                {o.depositCode ? (
                  <span className="text-sm font-semibold text-brand-ink">
                    عربون بالقسيمة{' '}
                    <bdi dir="ltr" className="num">
                      {o.depositCode}
                    </bdi>
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <Money
                  minor={o.totalMinor}
                  currency={o.currency as CurrencyCode}
                  className="text-lg font-bold text-ink"
                />
                <Button variant="secondary" size="md" icon={<CartIcon size={20} />} onClick={() => onOpen(o)}>
                  افتح في السلة
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </SalePanel>
  );
}
