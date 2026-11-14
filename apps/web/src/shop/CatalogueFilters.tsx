import { useId, useState } from 'react';
import type { ShopProductCard } from '@serva/core';
import { CURRENCIES, type CurrencyCode } from '@serva/core/currencies';
import { Button, Checkbox, cn, CONTROL_HEIGHT, Select, TextField, ToggleChip, useDensity } from '@serva/ui';
import {
  filterCount,
  NO_FILTERS,
  optionChoices,
  type OptionChoice,
  priceToMinor,
  type ShopFilters,
  type ShopSort,
} from './filters';

/** How many chips an option shows before «اعرض الكل» */
const SHOWN = 8;

const GROUP_LABELS = { letters: 'حروف', numbers: 'أرقام', ages: 'أعمار' } as const;

/** One option's chips: in order, the first few, the rest behind «اعرض كل …», sizes under their group */
function OptionChips({
  choice,
  picked,
  onToggle,
}: {
  choice: OptionChoice;
  picked: string[];
  onToggle: (value: string, on: boolean) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = choice.values.filter((v, i) => all || i < SHOWN || picked.includes(v.value));
  const hidden = choice.values.length - shown.length;
  const groups = choice.isSize ? [...new Set(shown.map((v) => v.group))] : [null];
  return (
    <div role="group" aria-label={choice.name} className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-ink">{choice.name}</p>
      {groups.map((group) => (
        <div key={group ?? 'all'} className="flex flex-col gap-1.5">
          {group && groups.length > 1 ? (
            <p className="text-xs text-ink-muted">{GROUP_LABELS[group]}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {shown
              .filter((v) => v.group === group)
              .map(({ value }) => (
                <ToggleChip
                  key={value}
                  label={value}
                  checked={picked.includes(value)}
                  onChange={(e) => onToggle(value, e.target.checked)}
                />
              ))}
          </div>
        </div>
      ))}
      {hidden > 0 ? (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
            {`اعرض كل ${choice.isSize ? 'المقاسات' : 'الخيارات'}`}
          </Button>
        </div>
      ) : all && choice.values.length > SHOWN ? (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setAll(false)}>
            اعرض أقل
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * «تصفية» and «ترتيب» over the goods: the pieces' options (size, colour…) as chips, a price range
 * when the store shows prices, «المتوفر فقط», and the sort. Prices never come into it for a store
 * that keeps them to itself: the range and the price sorts are not offered.
 */
export function CatalogueFilters({
  products,
  currency,
  showPrices,
  filters,
  onFilters,
  sort,
  onSort,
}: {
  products: readonly ShopProductCard[];
  currency: CurrencyCode;
  showPrices: boolean;
  filters: ShopFilters;
  onFilters: (next: ShopFilters) => void;
  sort: ShopSort;
  onSort: (next: ShopSort) => void;
}) {
  const density = useDensity();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const choices = optionChoices(products);
  const decimals = CURRENCIES[currency].decimals;
  const mixedStock = products.some((p) => !p.available);
  const count = filterCount(filters);
  const text = (minor: number | null) => (minor === null ? '' : String(minor / 10 ** decimals));
  const [priceText, setPriceText] = useState({ min: text(filters.minPrice), max: text(filters.maxPrice) });
  const hasAnything = choices.length > 0 || showPrices || mixedStock;

  function setPrice(side: 'min' | 'max', value: string) {
    const clipped = value.slice(0, 12);
    setPriceText((t) => ({ ...t, [side]: clipped }));
    const minor = priceToMinor(clipped, decimals);
    onFilters(side === 'min' ? { ...filters, minPrice: minor } : { ...filters, maxPrice: minor });
  }

  function toggle(name: string, value: string, on: boolean) {
    const now = filters.options[name] ?? [];
    const next = on ? [...now, value] : now.filter((v) => v !== value);
    onFilters({ ...filters, options: { ...filters.options, [name]: next } });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {hasAnything ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
            className={cn(
              CONTROL_HEIGHT[density],
              'inline-flex shrink-0 items-center gap-2 rounded-small border px-4 text-sm font-semibold transition-colors duration-120 ease-standard select-none',
              open || count > 0
                ? 'border-brand bg-brand-soft text-brand-ink'
                : 'border-line-control/50 bg-surface text-ink shadow-e1 hover:bg-surface-muted',
            )}
          >
            تصفية
            {count > 0 ? (
              <span className="num min-w-5 rounded-full bg-brand px-1.5 text-center text-xs/5 font-bold text-on-brand">
                {count}
              </span>
            ) : null}
          </button>
        ) : null}
        <Select
          label="الترتيب"
          value={sort}
          onChange={(e) => onSort(e.target.value as ShopSort)}
          className="w-44"
        >
          <option value="newest">الأحدث</option>
          {showPrices ? <option value="price-asc">السعر: الأقل أولاً</option> : null}
          {showPrices ? <option value="price-desc">السعر: الأعلى أولاً</option> : null}
          <option value="name">الاسم</option>
        </Select>
        {count > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onFilters(NO_FILTERS);
              setPriceText({ min: '', max: '' });
            }}
          >
            امسح التصفية
          </Button>
        ) : null}
      </div>
      {open && hasAnything ? (
        <section
          id={panelId}
          aria-label="التصفية"
          className="flex flex-col gap-5 rounded-card border border-line bg-surface p-4 shadow-e1 sm:p-5"
        >
          {choices.map((choice) => (
            <OptionChips
              key={choice.name}
              choice={choice}
              picked={filters.options[choice.name] ?? []}
              onToggle={(value, on) => toggle(choice.name, value, on)}
            />
          ))}
          {showPrices ? (
            <div role="group" aria-label="السعر" className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-ink">السعر ({CURRENCIES[currency].symbolAr})</p>
              <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
                <TextField
                  label="من"
                  dir="ltr"
                  inputMode="decimal"
                  value={priceText.min}
                  onChange={(e) => setPrice('min', e.target.value)}
                  inputClassName="num"
                />
                <TextField
                  label="إلى"
                  dir="ltr"
                  inputMode="decimal"
                  value={priceText.max}
                  onChange={(e) => setPrice('max', e.target.value)}
                  inputClassName="num"
                />
              </div>
            </div>
          ) : null}
          {mixedStock ? (
            <Checkbox
              label="المتوفر فقط"
              checked={filters.inStockOnly}
              onChange={(e) => onFilters({ ...filters, inStockOnly: e.target.checked })}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
