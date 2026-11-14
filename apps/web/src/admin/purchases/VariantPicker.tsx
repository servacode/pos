import { useEffect, useState } from 'react';
import { packOptionsOf, type PackOption, type ProductDetail, type ProductListItem } from '@serva/core';
import {
  AddIcon,
  Button,
  cn,
  CONTROL_HEIGHT,
  IconChip,
  ProductsIcon,
  SearchField,
  useDensity,
} from '@serva/ui';
import { getProduct, listProducts } from '../catalog/api';
import { gridOf, SizeGrid, type GridLine } from './SizeGrid';

export interface PickedVariant {
  variantId: string;
  name: string;
  /** The named packs of the item («علبة 100»), for typing a quantity in them */
  packs?: PackOption[];
  /** «يتطلب صلاحية»: a receipt of it needs an expiry date (03 › الصيدليات) */
  requiresExpiry?: boolean;
  /** «يتتبّع الرقم التسلسلي»: a receipt or a return of it takes one number per piece */
  tracksSerial?: boolean;
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
  const density = useDensity();
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
      .map((v) => ({
        variantId: v.id,
        name: v.label ? `${detail.nameAr} ${v.label}` : detail.nameAr,
        packs: packOptionsOf(v.barcodes),
        ...(detail.requiresExpiry ? { requiresExpiry: true } : {}),
        ...(detail.tracksSerial ? { tracksSerial: true } : {}),
      }));
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
        <div
          role="group"
          aria-label="اختر النوع"
          className="flex flex-col gap-3 rounded-card border border-line bg-surface-muted/40 p-4"
        >
          <p aria-hidden="true" className="text-sm font-semibold text-ink-muted">
            اختر النوع
          </p>
          <div className="flex flex-wrap gap-2">
            {choices.map((v) => (
              <Button
                key={v.variantId}
                variant="secondary"
                size="sm"
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
                <AddIcon
                  size={16}
                  className="text-ink-subtle transition-colors duration-120 ease-standard group-hover/item:text-brand-ink"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
