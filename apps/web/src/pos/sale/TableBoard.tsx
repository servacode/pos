import { Button, CloseIcon, cn, Money } from '@serva/ui';
import type { CurrencyCode } from '@serva/core/currencies';
import type { Cart } from './cart';

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
    <section
      aria-label="الطاولات"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-ink">الطاولات</h2>
        <Button variant="secondary" icon={<CloseIcon />} onClick={onClose}>
          أغلق
        </Button>
      </div>
      <ul className="grid grid-cols-3 gap-3 md:grid-cols-4 xl:grid-cols-6">
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
                  'flex h-24 w-full flex-col items-center justify-center gap-1 rounded-card border-2 text-ink',
                  cart ? 'border-warning bg-warning-soft' : 'border-line bg-surface hover:bg-surface-muted',
                  here && 'ring-2 ring-brand',
                )}
              >
                <span className="text-xl font-bold">{table}</span>
                {cart ? (
                  <span className="text-sm">
                    <Money minor={totalOf(cart)} currency={currency} />
                  </span>
                ) : (
                  <span className="text-sm text-ink-muted">فارغة</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
