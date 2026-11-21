import type { HallOrder } from '@serva/core';
import { Button, cn } from '@serva/ui';

/**
 * «انقل أو ادمج» (03 › المطاعم): the order of this table goes to a free table, or joins the order
 * on a busy one. The slips already with the kitchen show the new table.
 */
export function MoveView({
  order,
  tables,
  orders,
  busy,
  onMove,
  onMerge,
  onBack,
}: {
  order: HallOrder;
  tables: readonly string[];
  orders: readonly HallOrder[];
  busy: boolean;
  onMove: (table: string) => void;
  onMerge: (from: HallOrder) => void;
  onBack: () => void;
}) {
  const byTable = new Map(orders.map((o) => [o.table, o]));
  const others = tables.filter((t) => t !== order.table);
  return (
    <section aria-label={`نقل الطاولة ${order.table}`} className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">
        نقل الطاولة <span className="num">{order.table}</span>
      </h2>
      <p className="text-ink-muted">
        اختر طاولة فارغة لنقل الطلب إليها، أو طاولة مشغولة لدمج الطلبين في طلب واحد.
      </p>
      <ul className="grid grid-cols-3 gap-3">
        {others.map((table) => {
          const there = byTable.get(table);
          return (
            <li key={table}>
              <button
                type="button"
                disabled={busy}
                onClick={() => (there ? onMerge(there) : onMove(table))}
                aria-label={there ? `ادمج مع الطاولة ${table}` : `انقل إلى الطاولة ${table}`}
                className={cn(
                  'flex h-20 w-full flex-col items-center justify-center gap-1 rounded-card border text-ink shadow-e1 disabled:opacity-50',
                  there ? 'border-warning/30 bg-warning-soft' : 'border-line bg-surface',
                )}
              >
                <span className="num text-xl font-bold">{table}</span>
                <span className="text-sm text-ink-muted">{there ? 'ادمج' : 'فارغة'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button variant="ghost" size="lg" onClick={onBack}>
        رجوع
      </Button>
    </section>
  );
}
