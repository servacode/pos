import { useState } from 'react';
import {
  catalogOptionsOf,
  COUNT_NOUNS,
  countNoun,
  type CatalogOptions,
  type ProductDetail,
  type SizeRun,
} from '@serva/core';
import { AddIcon, Alert, Button, GridIcon, IconChip, NumberField, TextField } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import { orderValues } from '../../lib/optionOrder';
import { canManageCatalog } from '../catalog/catalog';
import { saveCatalogOptions } from '../store/api';
import { moneyOf, qtyOf } from './api';

export interface GridLine {
  variantId: string;
  name: string;
  /** Pieces, as typed */
  qty: string;
  /** The line's whole cost, as typed: pieces × the cost of one */
  cost: string;
  /** The cost of one piece as typed in the grid (an order line keeps the one, not the whole) */
  unit?: string;
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
    // The way a shop reads them: S M L XL, 36 38 40, 2 4 6 سنوات, not the order they were typed in
    return orderValues(name, out).map((o) => o.value);
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

/**
 * «طقم مقاسات»: the quantities one size run puts in the grid, `sets` runs of it for every colour:
 * the run's counts go along the sizes in the order the grid has them (1-2-2-1 over S-M-L-XL), a size
 * the run has no count for gets none. The axis called «المقاس» is the sizes; without one, the rows.
 */
export function sizeRunQuantities(
  variants: readonly Variant[],
  counts: readonly number[],
  sets: number,
): Record<string, string> {
  const grid = gridOf(variants);
  const sizesAreCols = grid.colName === 'المقاس' && grid.rowName !== 'المقاس';
  const sizes = sizesAreCols ? grid.cols : grid.rows;
  const others = sizesAreCols ? grid.rows : grid.cols;
  const out: Record<string, string> = {};
  for (const other of others) {
    sizes.forEach((size, i) => {
      const n = (counts[i] ?? 0) * sets;
      if (n <= 0) return;
      const cell = sizesAreCols ? grid.cell(other, size) : grid.cell(size, other);
      if (cell) out[cell.id] = String(n);
    });
  }
  return out;
}

/** How many sizes the grid has: the axis called «المقاس», or the rows */
export function sizeCountOf(variants: readonly Variant[]): number {
  const grid = gridOf(variants);
  const sizesAreCols = grid.colName === 'المقاس' && grid.rowName !== 'المقاس';
  return (sizesAreCols ? grid.cols : grid.rows).length;
}

/** What to tell the owner when a size run does not have one count for each size of the grid; null when it fits */
export function runMismatchNote(name: string, counts: number, sizes: number): string | null {
  if (counts === sizes) return null;
  return counts < sizes
    ? `«${name}» له ${String(counts)} من ${String(sizes)} مقاسات: الباقي بلا كمية.`
    : `«${name}» له ${String(counts)} أعداد والجدول ${String(sizes)} مقاسات فقط: الزائد يُهمَل.`;
}

/** «1-2-2-1» as [1, 2, 2, 1]; null when it is not a list of counts */
export function parseRunCounts(text: string): number[] | null {
  const parts = text
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .split(/[\s,،\-–]+/)
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 12) return null;
  const counts = parts.map(Number);
  return counts.every((n) => Number.isInteger(n) && n >= 0 && n <= 99) && counts.some((n) => n > 0)
    ? counts
    : null;
}

/** The size runs of the store and the editor of them, under the grid's title */
function SizeRuns({ sizes, onFill }: { sizes: number; onFill: (counts: number[], sets: number) => void }) {
  const me = useMe();
  const [options, setOptions] = useState<CatalogOptions>(() => catalogOptionsOf(me.settings.catalogOptions));
  const [sets, setSets] = useState('1');
  // A run's note about its count is told once the run is used, not before anything is typed
  const [used, setUsed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ name: string; counts: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canEdit = canManageCatalog(me);
  const setCount = Math.max(1, Math.min(99, Math.trunc(Number(sets)) || 1));

  async function save() {
    const runs: SizeRun[] = [];
    for (const row of draft) {
      if (row.name.trim() === '' && row.counts.trim() === '') continue;
      const counts = parseRunCounts(row.counts);
      if (row.name.trim() === '' || counts === null) {
        setError('اكتب لكل طقم اسماً وأعداداً مثل 1-2-2-1.');
        return;
      }
      runs.push({ name: row.name.trim(), counts });
    }
    setSaving(true);
    setError(null);
    try {
      const store = await saveCatalogOptions({ ...options, sizeRuns: runs });
      setOptions(catalogOptionsOf(store.catalogOptions));
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" role="group" aria-label="طقم مقاسات">
      <div className="flex flex-wrap items-end gap-2">
        <span className="text-sm font-semibold text-ink">طقم مقاسات</span>
        {options.sizeRuns.map((run) => (
          <Button
            key={run.name}
            variant="secondary"
            onClick={() => {
              setUsed(run.name);
              onFill(run.counts, setCount);
            }}
          >
            {run.name}
          </Button>
        ))}
        <TextField
          label="عدد الأطقم لكل لون"
          inputMode="numeric"
          dir="ltr"
          value={sets}
          onChange={(e) => setSets(e.target.value.replace(/\D/g, '').slice(0, 2))}
          className="w-32"
          inputClassName="num text-center"
        />
        {canEdit ? (
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(options.sizeRuns.map((r) => ({ name: r.name, counts: r.counts.join('-') })));
              setError(null);
              setEditing((e) => !e);
            }}
          >
            عدّل الأطقم
          </Button>
        ) : null}
      </div>
      {options.sizeRuns.map((run) => {
        if (run.name !== used) return null;
        const note = runMismatchNote(run.name, run.counts.length, sizes);
        return note ? (
          <p key={run.name} className="text-xs text-warning-ink">
            {note}
          </p>
        ) : null;
      })}
      {editing ? (
        <div className="flex flex-col gap-2 rounded-control border border-line bg-surface p-3">
          {draft.map((row, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <TextField
                label="اسم الطقم"
                value={row.name}
                onChange={(e) =>
                  setDraft((all) =>
                    all.map((r, j) => (j === i ? { ...r, name: e.target.value.slice(0, 30) } : r)),
                  )
                }
                className="w-48"
              />
              <TextField
                label="القطع لكل مقاس"
                hint="بترتيب المقاسات: 1-2-2-1"
                dir="ltr"
                value={row.counts}
                onChange={(e) =>
                  setDraft((all) =>
                    all.map((r, j) => (j === i ? { ...r, counts: e.target.value.slice(0, 40) } : r)),
                  )
                }
                className="w-40"
              />
              <Button variant="ghost" onClick={() => setDraft((all) => all.filter((_, j) => j !== i))}>
                احذف
              </Button>
            </div>
          ))}
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={draft.length >= 10}
              onClick={() => setDraft((all) => [...all, { name: '', counts: '' }])}
            >
              طقم جديد
            </Button>
            <Button loading={saving} onClick={() => void save()}>
              احفظ الأطقم
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
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
  initialUnit = '',
  noCost = false,
}: {
  product: ProductDetail;
  onAdd: (lines: GridLine[]) => void;
  onCancel: () => void;
  /** No cost box: the document does not take a cost (a transfer moves pieces at the cost the books hold) */
  noCost?: boolean;
  /** The last known cost of one piece, to start the cost box with (the owner changes it) */
  initialUnit?: string;
}) {
  const live = product.variants.filter((v) => !v.archivedAt);
  const grid = gridOf(live);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [unit, setUnit] = useState(initialUnit);
  const pieces = live
    .map((v) => ({ v, n: qtyOf(qty[v.id] ?? '') }))
    .filter((x): x is { v: Variant; n: number } => x.n !== null && x.n > 0);
  const totalPieces = pieces.reduce((n, x) => n + x.n / 1000, 0);
  const unitOk = noCost || moneyOf(unit) !== null;

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
          <p className="text-sm text-ink-muted">
            {noCost ? 'اكتب كمية كل قطعة.' : 'اكتب كمية كل قطعة، ثم كلفة القطعة الواحدة.'}
          </p>
        </div>
      </div>
      <SizeRuns
        sizes={sizeCountOf(live)}
        onFill={(counts, sets) => setQty((all) => ({ ...all, ...sizeRunQuantities(live, counts, sets) }))}
      />
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
        {noCost ? null : (
          <NumberField
            label="كلفة القطعة الواحدة"
            decimals={2}
            value={unit}
            onValueChange={(v) => setUnit(v.slice(0, 14))}
            className="w-full sm:w-48"
            unit="ل.س"
          />
        )}
        <Button
          icon={<AddIcon />}
          disabled={pieces.length === 0 || !unitOk}
          onClick={() =>
            onAdd(
              pieces.map(({ v, n }) => ({
                variantId: v.id,
                name: v.label ? `${product.nameAr} ${v.label}` : product.nameAr,
                qty: qty[v.id]!.trim(),
                cost: noCost ? '' : costText(unit, n / 1000),
                unit: noCost ? '' : unit.trim(),
              })),
            )
          }
        >
          أضف {countNoun(totalPieces, COUNT_NOUNS.piece, String(totalPieces), true)}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          إلغاء
        </Button>
      </div>
    </div>
  );
}
