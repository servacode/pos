import { useEffect, useState } from 'react';
import { packOptionsOf, type ProductListItem, type TaxRate, type Unit } from '@serva/core';
import { AddIcon, cn, CONTROL_HEIGHT, IconChip, ProductsIcon, SearchField, useDensity } from '@serva/ui';
import { errorMessage } from '../../lib/api';
import { getProduct, listProducts } from '../catalog/api';
import { moneyText, nextKey, packPriceOf, type EditorLine } from './lines';

/**
 * Finds a product by name or barcode and gives back a line for it: its name and variant, the price in
 * the store's currency (the pack's own price when it has one), its unit and its tax rate. A product
 * with several variants asks which one first.
 */
export function ItemPicker({
  currency,
  taxRates,
  units,
  onPick,
  onError,
}: {
  currency: string;
  taxRates: readonly TaxRate[];
  units: readonly Unit[];
  onPick: (line: EditorLine) => void;
  onError: (message: string) => void;
}) {
  const density = useDensity();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ProductListItem[]>([]);
  const [choices, setChoices] = useState<EditorLine[] | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setItems([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      listProducts({ q: q.trim() })
        .then((page) => alive && setItems(page.items.filter((p) => !p.archivedAt).slice(0, 8)))
        .catch(() => alive && setItems([]));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  function done(line: EditorLine) {
    onPick(line);
    setQ('');
    setItems([]);
    setChoices(null);
  }

  async function choose(p: ProductListItem) {
    try {
      const detail = await getProduct(p.id);
      const rate = taxRates.find((t) => t.id === detail.taxRateId && !t.archivedAt) ?? null;
      const unit = units.find((u) => u.id === detail.unitId);
      const lines = detail.variants
        .filter((v) => !v.archivedAt)
        .map((v): EditorLine => {
          const inCurrency = v.price.currency === currency;
          const packPrices: Record<number, number> = {};
          for (const b of v.barcodes) {
            if (b.packQty > 1000 && b.packPriceMinor !== null && inCurrency)
              packPrices[b.packQty] = b.packPriceMinor;
          }
          const line: EditorLine = {
            key: nextKey(),
            productId: detail.id,
            variantId: v.id,
            name: v.label ? `${detail.nameAr} ${v.label}` : detail.nameAr,
            unitName: unit && unit.symbol !== 'قطعة' && unit.allowsFraction ? unit.symbol : null,
            packName: null,
            packQty: 1000,
            packs: packOptionsOf(v.barcodes),
            pieceMinor: inCurrency ? v.price.priceMinor : null,
            packPrices,
            qty: '1',
            price: '',
            discount: '',
            taxRateId: rate?.id ?? null,
            taxRateBp: rate?.rateBp ?? 0,
          };
          const first = packPriceOf(line, 1000);
          return { ...line, price: first === null ? '' : moneyText(first) };
        });
      if (lines.length === 1) done(lines[0]!);
      else setChoices(lines);
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <SearchField label="أضف صنفاً بالاسم أو الباركود" value={q} onValueChange={setQ} />
      {choices ? (
        <div
          role="group"
          aria-label="اختر النوع"
          className="flex flex-wrap gap-2 rounded-card border border-line bg-surface-muted/40 p-4"
        >
          {choices.map((line) => (
            <button
              key={line.key}
              type="button"
              onClick={() => done(line)}
              className="rounded-control border border-line-control bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-muted"
            >
              {line.name}
            </button>
          ))}
        </div>
      ) : items.length > 0 ? (
        <ul
          aria-label="نتائج البحث"
          className="flex flex-col gap-0.5 rounded-card border border-line bg-surface p-1.5 shadow-e2"
        >
          {items.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => void choose(p)}
                className={cn(
                  'group/item flex w-full items-center gap-3 rounded-small px-2.5 text-start text-[0.9375rem] text-ink transition-colors duration-120 ease-standard hover:bg-surface-muted',
                  CONTROL_HEIGHT[density],
                )}
              >
                <IconChip size="sm" tone="neutral">
                  <ProductsIcon size={16} />
                </IconChip>
                <span className="min-w-0 flex-1 truncate font-semibold">{p.nameAr}</span>
                <AddIcon size={16} className="text-ink-subtle group-hover/item:text-brand-ink" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
