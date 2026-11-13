import { useMemo, useState } from 'react';
import type { HallOrder } from '@serva/core';
import type { CurrencyCode } from '@serva/core/currencies';
import { Alert, Button, CloseIcon, cn, Money } from '@serva/ui';
import { OptionChip } from '../FlowParts';
import { SalePanel } from '../sale/SalePanel';

/**
 * «قسّم الحساب» (03 › المطاعم › الدفع): a table's bill charged in parts, each part a sale of its own.
 * By items (or by seat): the lines picked become this sale and the rest stay on the table. Equally:
 * the whole order cut into N shares, the last taking the rounding remainder. The order closes on the
 * server by itself once every part is paid.
 */
export function SplitBill({
  order,
  currency,
  totalOf,
  blocked,
  onItems,
  onEqual,
  onClose,
}: {
  order: HallOrder;
  currency: CurrencyCode;
  /** What these lines come to as a sale, by the till's own pricing */
  totalOf: (lineIds: string[]) => number;
  /** Why splitting is not possible now (lines not yet sent), or null */
  blocked: string | null;
  onItems: (lineIds: string[]) => void;
  onEqual: (parts: number) => void;
  onClose: () => void;
}) {
  const paid = useMemo(() => new Set(order.paidLineIds), [order.paidLineIds]);
  const open = useMemo(
    () => order.lines.filter((l) => l.status !== 'cancelled' && !paid.has(l.id)),
    [order.lines, paid],
  );
  const seats = useMemo(
    () => [...new Set(open.flatMap((l) => (l.seat ? [l.seat] : [])))].sort((a, b) => a - b),
    [open],
  );
  const equalStarted = order.equal !== null;
  const itemsStarted = paid.size > 0;
  const [tab, setTab] = useState<'items' | 'equal'>(equalStarted ? 'equal' : 'items');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [parts, setParts] = useState(order.equal?.parts ?? Math.min(Math.max(order.guests ?? 2, 2), 30));

  const toggle = (id: string) =>
    setPicked((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const seatIds = (seat: number) => open.filter((l) => l.seat === seat).map((l) => l.id);
  const seatPicked = (seat: number) => seatIds(seat).every((id) => picked.has(id));
  const toggleSeat = (seat: number) =>
    setPicked((now) => {
      const next = new Set(now);
      const ids = seatIds(seat);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  const pickedIds = open.filter((l) => picked.has(l.id)).map((l) => l.id);
  const everything = pickedIds.length === open.length;

  return (
    <SalePanel
      label="تقسيم الحساب"
      title={`تقسيم حساب الطاولة ${order.table}`}
      subtitle="كل جزء فاتورة مبيعات مستقلة، والطاولة تُغلق بعد دفع آخر جزء."
      actions={
        <Button variant="secondary" size="md" icon={<CloseIcon size={20} />} onClick={onClose}>
          أغلق
        </Button>
      }
    >
      {blocked ? <Alert tone="warning">{blocked}</Alert> : null}
      <div role="group" aria-label="طريقة التقسيم" className="flex flex-wrap gap-2">
        <OptionChip selected={tab === 'items'} disabled={equalStarted} onClick={() => setTab('items')}>
          بالأصناف أو المقاعد
        </OptionChip>
        <OptionChip selected={tab === 'equal'} disabled={itemsStarted} onClick={() => setTab('equal')}>
          بالتساوي
        </OptionChip>
      </div>

      {tab === 'items' ? (
        <>
          {seats.length > 0 ? (
            <div role="group" aria-label="المقاعد" className="flex flex-wrap gap-2">
              {seats.map((seat) => (
                <OptionChip key={seat} selected={seatPicked(seat)} onClick={() => toggleSeat(seat)}>
                  مقعد {seat}
                </OptionChip>
              ))}
            </div>
          ) : null}
          <ul aria-label="أصناف الطاولة" className="flex flex-col divide-y divide-line">
            {open.map((line) => (
              <li key={line.id}>
                <label
                  className={cn(
                    'flex min-h-14 cursor-pointer items-center gap-3 px-1 py-2',
                    picked.has(line.id) && 'bg-brand-soft/50',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-5 accent-brand"
                    checked={picked.has(line.id)}
                    onChange={() => toggle(line.id)}
                    aria-label={`${line.qty}× ${line.name}`}
                  />
                  <span className="num font-bold">{line.qty}×</span>
                  <span className="min-w-0 flex-1 truncate">{line.name}</span>
                  {line.seat ? <span className="text-sm text-ink-subtle">مقعد {line.seat}</span> : null}
                  <Money
                    minor={totalOf([line.id])}
                    currency={currency}
                    className="font-semibold text-ink-muted"
                  />
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              disabled={blocked !== null || pickedIds.length === 0}
              onClick={() => onItems(pickedIds)}
            >
              {everything && pickedIds.length > 0 ? 'ادفع الكل' : 'ادفع المحدد'}
              {pickedIds.length > 0 ? (
                <>
                  {' '}
                  <Money minor={totalOf(pickedIds)} currency={currency} />
                </>
              ) : null}
            </Button>
            <Button
              variant="ghost"
              size="md"
              disabled={pickedIds.length === 0}
              onClick={() => setPicked(new Set())}
            >
              امسح الاختيار
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-4">
          {order.equal ? (
            <p role="status" className="text-ink-muted">
              الحساب مقسوم إلى <span className="num font-bold">{order.equal.parts}</span> أجزاء متساوية، دُفع
              منها <span className="num font-bold">{order.equal.paid}</span>.
            </p>
          ) : (
            <div className="flex items-center gap-3">
              <span className="font-semibold">عدد الأشخاص</span>
              <Button
                variant="secondary"
                size="md"
                aria-label="أنقص"
                disabled={parts <= 2}
                onClick={() => setParts((n) => Math.max(2, n - 1))}
              >
                −
              </Button>
              <span aria-label="عدد الأجزاء" className="num min-w-10 text-center text-2xl font-bold">
                {parts}
              </span>
              <Button
                variant="secondary"
                size="md"
                aria-label="زِد"
                disabled={parts >= 30}
                onClick={() => setParts((n) => Math.min(30, n + 1))}
              >
                +
              </Button>
            </div>
          )}
          <p className="text-ink-muted">
            الجزء الأول يُحسب على هذا الجهاز، والجزء الأخير يأخذ فرق التقريب، فيجتمع الحساب كاملاً.
          </p>
          <div>
            <Button size="lg" disabled={blocked !== null} onClick={() => onEqual(parts)}>
              {order.equal
                ? `ادفع الجزء ${order.equal.paid + 1} من ${order.equal.parts}`
                : `ابدأ: الجزء الأول من ${parts}`}
            </Button>
          </div>
          <p className="text-sm text-ink-subtle">
            الحساب كله <Money minor={totalOf(open.map((l) => l.id))} currency={currency} />
          </p>
        </div>
      )}
    </SalePanel>
  );
}
