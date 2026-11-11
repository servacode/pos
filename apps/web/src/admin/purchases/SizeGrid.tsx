import { useState } from 'react';
import type { ProductDetail } from '@serva/core';
import { AddIcon, Button, GridIcon, IconChip, TextField } from '@serva/ui';
import { moneyOf, qtyOf } from './api';

export interface GridLine {
  variantId: string;
  name: string;
  /** Pieces, as typed */
  qty: string;
  /** The line's whole cost, as typed: pieces × the cost of one */
  cost: string;
}

type Variant = ProductDetail['variants'][number];

/** The pieces of a model laid out by their first two options: rows × columns, one cell each. */
export function gridOf(variants: readonly Variant[]) {
  const names: string[] = [];
  for (const v of variants) for (const a of v.attributes) if (!names.includes(a.name)) names.push(a.name);
  const [rowName = '', colName = ''] = names;
  const valuesOf = (name: string) => {
    const out: string[] = [];
    for (const v of variants) {
      const value = v.attributes.find((a) => a.name === name)?.value;
      if (value !== undefined && !out.includes(value)) out.push(value);
    }
    return out;
  };
  const rows = valuesOf(rowName);
  const cols = colName ? valuesOf(colName) : [''];
  const cell = (row: string, col: string) =>
    variants.find(
      (v) =>
        v.attributes.find((a) => a.name === rowName)?.value === row &&
        (!colName || v.attributes.find((a) => a.name === colName)?.value === col),
    ) ?? null;
  return { rowName, colName, rows, cols, cell, fits: names.length >= 1 && names.length <= 2 };
}

/** The line's cost text for `pieces` at the typed cost of one, in whole minor units. */
export function costText(unitText: string, pieces: number): string {
  const unit = moneyOf(unitText);
  if (unit === null) return '';
  const total = Math.round(unit * pieces);
  return total % 100 === 0 ? String(total / 100) : (total / 100).toFixed(2);
}

/**
 * «جدول المقاسات» on a purchase (03 › الألبسة): a model's pieces as a grid, sizes down and colours
 * across, a quantity in each cell and one cost per piece, added to the invoice in one go instead of
 * one line at a time.
 */
export function SizeGrid({
  product,
  onAdd,
  onCancel,
}: {
  product: ProductDetail;
  onAdd: (lines: GridLine[]) => void;
  onCancel: () => void;
}) {
  const live = product.variants.filter((v) => !v.archivedAt);
  const grid = gridOf(live);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [unit, setUnit] = useState('');
  const pieces = live
    .map((v) => ({ v, n: qtyOf(qty[v.id] ?? '') }))
    .filter((x): x is { v: Variant; n: number } => x.n !== null && x.n > 0);
  const totalPieces = pieces.reduce((n, x) => n + x.n / 1000, 0);
  const unitOk = moneyOf(unit) !== null;

  return (
    <div
      className="flex flex-col gap-4 rounded-card border border-line bg-surface-muted/40 p-4"
      role="group"
      aria-label={`جدول ${product.nameAr}`}
    >
      <div className="flex items-center gap-3">
        <IconChip>
          <GridIcon />
        </IconChip>
        <div className="flex min-w-0 flex-col">
          <p className="truncate font-semibold text-ink">{product.nameAr}</p>
          <p className="text-sm text-ink-muted">اكتب كمية كل قطعة، ثم كلفة القطعة الواحدة.</p>
        </div>
      </div>
      <div className="w-fit max-w-full overflow-x-auto rounded-control border border-line bg-surface">
        <table className="border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface-muted">
              <th
                scope="col"
                className="sticky start-0 z-10 bg-surface-muted px-3 py-2 text-start text-xs font-semibold whitespace-nowrap text-ink-subtle"
              >
                {grid.rowName}
                {grid.colName ? ` / ${grid.colName}` : ''}
              </th>
              {grid.cols.map((col) => (
                <th
                  key={col || '_'}
                  scope="col"
                  className="px-1.5 py-2 text-center text-xs font-semibold whitespace-nowrap text-ink-muted"
                >
                  {col || 'الكمية'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row} className="border-b border-line last:border-0">
                <th
                  scope="row"
                  className="sticky start-0 z-10 bg-surface px-3 py-1.5 text-start text-sm font-semibold whitespace-nowrap text-ink"
                >
                  {row}
                </th>
                {grid.cols.map((col) => {
                  const v = grid.cell(row, col);
                  return (
                    <td key={col || '_'} className="px-1.5 py-1.5">
                      {v ? (
                        <TextField
                          label={`كمية ${v.label ?? row}`}
                          hideLabel
                          inputMode="decimal"
                          value={qty[v.id] ?? ''}
                          onChange={(e) => setQty((all) => ({ ...all, [v.id]: e.target.value.slice(0, 8) }))}
                          className="relative w-18"
                          inputClassName="num text-center"
                        />
                      ) : (
                        <span aria-hidden="true" className="block w-18 text-center text-ink-subtle">
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label="كلفة القطعة الواحدة"
          dir="ltr"
          inputMode="decimal"
          value={unit}
          onChange={(e) => setUnit(e.target.value.slice(0, 14))}
          className="w-full sm:w-48"
          endAdornment={<span className="me-3 text-sm">ل.س</span>}
        />
        <Button
          icon={<AddIcon />}
          disabled={pieces.length === 0 || !unitOk}
          onClick={() =>
            onAdd(
              pieces.map(({ v, n }) => ({
                variantId: v.id,
                name: v.label ? `${product.nameAr} ${v.label}` : product.nameAr,
                qty: qty[v.id]!.trim(),
                cost: costText(unit, n / 1000),
              })),
            )
          }
        >
          أضف {totalPieces} قطعة
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          إلغاء
        </Button>
      </div>
    </div>
  );
}
