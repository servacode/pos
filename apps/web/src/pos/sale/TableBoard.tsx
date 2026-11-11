import { Button, CloseIcon, cn, Money } from '@serva/ui';
import type { CurrencyCode } from '@serva/core/currencies';
import type { Cart } from './cart';
import { SalePanel } from './SalePanel';

/**
 * «خريطة الصالة» (03 › المطاعم): the hall's tables, free or with an open order and what it holds.
 * A table opens its order; a free one starts a new one (or takes the order being taken now).
 */
export function TableBoard({
  tables,
  held,
  current,
  totalOf,
  currency,
  onPick,
  onClose,
}: {
  tables: readonly string[];
  held: readonly Cart[];
  current: Cart;
  totalOf: (cart: Cart) => number;
  currency: CurrencyCode;
  onPick: (table: string) => void;
  onClose: () => void;
}) {
  const open = new Map<string, Cart>();
  for (const cart of held) if (cart.service?.table) open.set(cart.service.table, cart);
  if (current.service?.table && current.lines.length > 0) open.set(current.service.table, current);
  return (
    <SalePanel
      label="الطاولات"
      title="الطاولات"
      actions={
        <Button variant="secondary" size="md" icon={<CloseIcon size={20} />} onClick={onClose}>
          أغلق
        </Button>
      }
    >
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
        {tables.map((table) => {
          const cart = open.get(table);
          const here = current.service?.table === table;
          return (
            <li key={table}>
              <button
                type="button"
                onClick={() => onPick(table)}
                aria-label={`طاولة ${table}${cart ? ' مشغولة' : ' فارغة'}`}
                className={cn(
                  'flex h-24 w-full flex-col items-center justify-center gap-1 rounded-card border text-ink transition-[background-color,border-color,box-shadow,translate] duration-120 ease-standard motion-safe:active:scale-[0.98]',
                  cart
                    ? 'border-warning/30 bg-warning-soft'
                    : 'border-line bg-surface shadow-e1 hover:border-line-control/50 hover:shadow-e2',
                  here && 'ring-2 ring-brand ring-offset-2 ring-offset-surface',
                )}
              >
                <span className="num text-2xl font-bold">{table}</span>
                {cart ? (
                  <Money
                    minor={totalOf(cart)}
                    currency={currency}
                    className="text-sm font-semibold text-warning-ink"
                  />
                ) : (
                  <span className="text-sm text-ink-muted">فارغة</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </SalePanel>
  );
}
