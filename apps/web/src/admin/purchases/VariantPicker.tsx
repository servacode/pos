import { useEffect, useState } from 'react';
import type { ProductDetail, ProductListItem } from '@serva/core';
import { Button, SearchField } from '@serva/ui';
import { getProduct, listProducts } from '../catalog/api';
import { gridOf, SizeGrid, type GridLine } from './SizeGrid';

export interface PickedVariant {
  variantId: string;
  name: string;
}

/**
 * Finds a stocked product by name or barcode and gives back one of its variants; a model in sizes
 * and colours opens as a grid when `onPickGrid` is given, its quantities typed in one go.
 */
export function VariantPicker({
  onPick,
  onPickGrid,
}: {
  onPick: (v: PickedVariant) => void;
  onPickGrid?: (lines: GridLine[]) => void;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ProductListItem[]>([]);
  const [choices, setChoices] = useState<PickedVariant[] | null>(null);
  const [grid, setGrid] = useState<ProductDetail | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setItems([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      listProducts({ q: q.trim() })
        .then((page) => alive && setItems(page.items.filter((p) => p.type === 'stock').slice(0, 8)))
        .catch(() => alive && setItems([]));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  async function choose(p: ProductListItem) {
    const detail = await getProduct(p.id);
    const variants = detail.variants
      .filter((v) => !v.archivedAt)
      .map((v) => ({ variantId: v.id, name: v.label ? `${detail.nameAr} ${v.label}` : detail.nameAr }));
    if (variants.length === 1) {
      onPick(variants[0]!);
      setQ('');
      setItems([]);
    } else if (onPickGrid && gridOf(detail.variants.filter((v) => !v.archivedAt)).fits) {
      setGrid(detail);
      setItems([]);
    } else setChoices(variants);
  }

  return (
    <div className="flex flex-col gap-2">
      <SearchField label="أضف صنفاً بالاسم أو الباركود" value={q} onValueChange={setQ} />
      {grid && onPickGrid ? (
        <SizeGrid
          product={grid}
          onAdd={(lines) => {
            onPickGrid(lines);
            setGrid(null);
            setQ('');
          }}
          onCancel={() => setGrid(null)}
        />
      ) : choices ? (
        <div role="group" aria-label="اختر النوع" className="flex flex-wrap gap-2">
          {choices.map((v) => (
            <Button
              key={v.variantId}
              variant="secondary"
              onClick={() => {
                onPick(v);
                setChoices(null);
                setQ('');
                setItems([]);
              }}
            >
              {v.name}
            </Button>
          ))}
        </div>
      ) : items.length > 0 ? (
        <ul aria-label="نتائج البحث" className="flex flex-col gap-1">
          {items.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => void choose(p)}
                className="min-h-11 w-full rounded-control px-3 text-start font-semibold text-ink hover:bg-surface-muted"
              >
                {p.nameAr}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
