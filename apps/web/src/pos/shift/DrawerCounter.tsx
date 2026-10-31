import { CURRENCIES, type CurrencyCode } from '@serva/core/currencies';
import { toLatinDigits } from '@serva/core/text';
import { AddIcon, Button, cn, Money, RemoveIcon } from '@serva/ui';
import { parseAmount, amountText } from '../pay/payment';
import { countTotal, DENOMINATIONS, type DrawerCount } from './shift';

export function emptyCount(currency: CurrencyCode): DrawerCount {
  const notes = DENOMINATIONS[currency];
  return notes
    ? { currency, notes: Object.fromEntries(notes.map((v) => [v, 0])), totalMinor: 0 }
    : { currency, notes: null, totalMinor: 0 };
}

const drawerName = (currency: CurrencyCode) =>
  currency === 'SYP'
    ? 'درج الليرة'
    : currency === 'USD'
      ? 'درج الدولار'
      : `درج ${(CURRENCIES[currency] as { nameAr: string }).nameAr}`;

/**
 * One drawer counted by note (kit cashier/ShiftOpen and ShiftClose: «اكتب عدد الأوراق من كل فئة»),
 * or as a total when the cashier skips the count. Every count field is 48 px with − and +.
 */
export function DrawerCounter({
  count,
  onChange,
}: {
  count: DrawerCount;
  onChange: (next: DrawerCount) => void;
}) {
  const { currency } = count;
  const byNote = count.notes !== null;
  return (
    <section
      aria-label={drawerName(currency)}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
    >
      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-lg font-bold text-ink">{drawerName(currency)}</h2>
        <Money minor={countTotal(count)} currency={currency} className="text-xl font-bold text-ink" />
      </div>
      {byNote ? (
        <ul className="flex flex-col gap-2">
          {DENOMINATIONS[currency]!.map((value) => {
            const n = count.notes![value] ?? 0;
            const set = (next: number) =>
              onChange({
                ...count,
                notes: { ...count.notes!, [value]: Math.max(0, Math.min(99_999, next)) },
              });
            const label = `${amountText(value, currency)} ${CURRENCIES[currency].symbolAr}`;
            return (
              <li key={value} className="flex items-center gap-3">
                <span className="num w-24 font-semibold text-ink">{label}</span>
                <span aria-hidden="true" className="text-ink-muted">
                  ×
                </span>
                <div className="inline-flex items-center overflow-hidden rounded-control border border-line-control">
                  <button
                    type="button"
                    aria-label={`أنقص ${label}`}
                    onClick={() => set(n - 1)}
                    className="grid size-12 place-items-center hover:bg-surface-muted"
                  >
                    <RemoveIcon size={16} />
                  </button>
                  <input
                    aria-label={`عدد أوراق ${label}`}
                    inputMode="numeric"
                    value={n === 0 ? '' : String(n)}
                    placeholder="0"
                    onChange={(e) => set(Number(toLatinDigits(e.target.value).replace(/\D/g, '') || '0'))}
                    className="num h-12 w-16 border-x border-line bg-surface text-center text-lg font-bold outline-none"
                  />
                  <button
                    type="button"
                    aria-label={`زِد ${label}`}
                    onClick={() => set(n + 1)}
                    className="grid size-12 place-items-center hover:bg-surface-muted"
                  >
                    <AddIcon size={16} />
                  </button>
                </div>
                <span className="flex-1" />
                <Money minor={value * n} currency={currency} symbol={false} className="text-ink-muted" />
              </li>
            );
          })}
        </ul>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink">المجموع</span>
          <input
            inputMode="decimal"
            dir="ltr"
            value={count.totalMinor ? amountText(count.totalMinor, currency) : ''}
            placeholder="0"
            onChange={(e) =>
              onChange({
                ...count,
                totalMinor: parseAmount(toLatinDigits(e.target.value).replace(/[^\d.]/g, ''), currency) ?? 0,
              })
            }
            className="num h-14 rounded-control border border-line-control bg-surface px-4 text-2xl font-bold outline-none focus:border-ring"
          />
        </label>
      )}
      {DENOMINATIONS[currency] ? (
        <Button
          variant="ghost"
          className={cn('self-start')}
          onClick={() =>
            onChange(byNote ? { currency, notes: null, totalMinor: countTotal(count) } : emptyCount(currency))
          }
        >
          {byNote ? 'تخطَّ العدّ واكتب المجموع' : 'عُدّ بالفئات'}
        </Button>
      ) : null}
    </section>
  );
}
