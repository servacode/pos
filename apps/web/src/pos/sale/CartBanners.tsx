import type { CurrencyCode } from '@serva/core/currencies';
import { Button, ClockIcon, cn, InboxIcon, Money, SendIcon, UndoIcon } from '@serva/ui';
import type { Catalog } from '../catalog';
import { kitchenLines, markSent, type Cart } from './cart';
import { ORDER_TYPE_TEXT, type KitchenData } from '../receipt/KitchenTicket';
import type { SaleMode, SaleScreenProps } from './saleTypes';

export interface CartBannersProps {
  service: NonNullable<NonNullable<Catalog['settings']>['service']> | null;
  orderType: 'dine_in' | 'takeaway' | 'delivery';
  defaultOrderType: 'dine_in' | 'takeaway';
  cart: Cart;
  setCart: SaleScreenProps['setCart'];
  setMode: (mode: SaleMode) => void;
  hallTools: SaleScreenProps['hallTools'];
  onKitchenSent: SaleScreenProps['onKitchenSent'];
  setKitchen: (data: KitchenData) => void;
  cashierName: string;
  currency: CurrencyCode;
}

/** The order type and kitchen tools, and the strips that say what the cart is tied to (a shop order, a voucher, a hold) */
export function CartBanners({
  service,
  orderType,
  defaultOrderType,
  cart,
  setCart,
  setMode,
  hallTools,
  onKitchenSent,
  setKitchen,
  cashierName,
  currency,
}: CartBannersProps) {
  return (
    <>
      {service ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div
            role="group"
            aria-label="نوع الطلب"
            className="inline-flex gap-1 rounded-control bg-surface-muted p-1"
          >
            {(['dine_in', 'takeaway', 'delivery'] as const).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={orderType === type}
                onClick={() =>
                  setCart((c) => ({
                    ...c,
                    service: {
                      orderType: type,
                      table: type === 'dine_in' ? (c.service?.table ?? null) : null,
                    },
                  }))
                }
                className={cn(
                  'min-h-12 rounded-small px-4 text-base font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-120 ease-standard',
                  orderType === type
                    ? 'bg-surface text-ink shadow-e1 ring-1 ring-line'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {ORDER_TYPE_TEXT[type]}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          {hallTools?.order && cart.hall ? (
            <Button variant="secondary" size="md" onClick={() => setMode({ kind: 'split' })}>
              قسّم الحساب
            </Button>
          ) : null}
          {service.tables.length > 0 ? (
            <Button variant="secondary" size="md" onClick={() => setMode({ kind: 'tables' })}>
              {cart.service?.table ? `طاولة ${cart.service.table}` : 'الطاولات'}
            </Button>
          ) : null}
          {service.kitchenTickets && kitchenLines(cart).length > 0 ? (
            <Button
              variant="secondary"
              size="md"
              icon={<SendIcon size={20} />}
              onClick={() => {
                setKitchen({
                  lines: kitchenLines(cart),
                  orderType: cart.service?.orderType ?? defaultOrderType,
                  table: cart.service?.table ?? null,
                  at: Date.now(),
                  cashierName: cashierName,
                });
                onKitchenSent?.(cart);
                setCart(markSent);
              }}
            >
              للمطبخ
            </Button>
          ) : null}
        </div>
      ) : null}
      {cart.onlineOrder ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-3 border-b border-line bg-brand-soft py-2 ps-4 pe-2 text-sm text-brand-ink"
        >
          <InboxIcon size={20} className="shrink-0" />
          <span className="min-w-0 flex-1">
            طلب المتجر{' '}
            <bdi dir="ltr" className="num font-semibold">
              {cart.onlineOrder.number}
            </bdi>{' '}
            · {cart.onlineOrder.customerName}: يُغلق عند الدفع
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCart((c) => ({ ...c, onlineOrder: undefined }))}
          >
            افصل الطلب
          </Button>
        </div>
      ) : null}
      {cart.voucher ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-3 border-b border-line bg-brand-soft py-2 ps-4 pe-2 text-sm text-brand-ink"
        >
          <UndoIcon size={20} className="shrink-0" />
          <span className="min-w-0 flex-1">
            {cart.alteration ? 'عربون التقصير' : cart.rental ? 'عربون الإيجار' : 'استبدال'}: القسيمة{' '}
            <bdi dir="ltr" className="num font-semibold">
              {cart.voucher}
            </bdi>{' '}
            تُخصم عند الدفع
          </span>
          <Button size="sm" variant="ghost" onClick={() => setCart((c) => ({ ...c, voucher: undefined }))}>
            ألغِ
          </Button>
        </div>
      ) : null}
      {cart.resumedName ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-muted px-4 py-1.5 text-sm text-ink-muted"
        >
          <ClockIcon size={20} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            فاتورة معلّقة: <span className="font-semibold text-ink">{cart.resumedName}</span>
          </span>
        </div>
      ) : null}
      {cart.exchangeCashBackMinor ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-3 border-b border-line bg-brand-soft py-2 ps-4 pe-2 text-sm text-brand-ink"
        >
          <UndoIcon size={20} className="shrink-0" />
          <span className="min-w-0 flex-1">
            استبدال نقدي: رُدَّ للزبون <Money minor={cart.exchangeCashBackMinor} currency={currency} /> نقداً،
            والبديل يُدفع كاملاً.
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCart((c) => ({ ...c, exchangeCashBackMinor: undefined }))}
          >
            أخفِ
          </Button>
        </div>
      ) : null}
    </>
  );
}
