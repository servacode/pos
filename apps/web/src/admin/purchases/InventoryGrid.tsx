import { useState } from 'react';
import type { InventoryRow } from '@serva/core';
import { Button, cn, formatQuantity, SegmentedControl } from '@serva/ui';
import { negativePieces } from '../stockWords';
import { ChevDown, ChevLeft } from '../sales/ui';
import { gridOf } from './SizeGrid';

/** The models the grid shows before «اعرض الكل» */
const GRID_FIRST = 10;

type Piece = Pick<InventoryRow, 'variantId' | 'qty'> & { attributes: { name: string; value: string }[] };

/**
 * The stock of every model that has sizes and colours, as one small grid each: sizes down, colours
 * across, the quantity in each cell (every branch shown, added together). A piece the list has no
 * options for stays in the list view.
 */
export function InventoryGrid({
  rows,
  numberFormat,
  onCount,
}: {
  rows: readonly InventoryRow[];
  numberFormat: 'latn' | 'arab';
  /** «صحّح بالجرد» (on the open model only): opens the count on these pieces; absent when the person cannot count */
  onCount?: (variantIds: string[]) => void;
}) {
  // Which models show: all, those with a piece below zero or out, those running low (2 or fewer)
  const [filter, setFilter] = useState<'all' | 'out' | 'low'>('all');
  // A model the person opened or closed by hand; the others follow the default (the first one open, the rest folded: the page stays short)
  // A long list shows its first ten models (the thinnest sizes); the rest open from «اعرض الكل»
  const [showAll, setShowAll] = useState(false);
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const byProduct = new Map<string, { name: string; pieces: Map<string, Piece> }>();
  for (const r of rows) {
    if (!r.productId || !r.attributes || r.attributes.length === 0) continue;
    const model = byProduct.get(r.productId) ?? { name: r.productName ?? r.name, pieces: new Map() };
    const piece = model.pieces.get(r.variantId);
    if (piece) piece.qty += r.qty;
    else model.pieces.set(r.variantId, { variantId: r.variantId, qty: r.qty, attributes: r.attributes });
    byProduct.set(r.productId, model);
  }
  const allModels = [...byProduct.entries()]
    .map(([id, m]) => {
      const pieces = [...m.pieces.values()];
      return { id, name: m.name, pieces, lowest: Math.min(...pieces.map((p) => p.qty)) };
    })
    // The models with the thinnest size first: that is the one to restock
    .sort((a, b) => a.lowest - b.lowest || a.name.localeCompare(b.name, 'ar'));
  const matching = allModels.filter((m) =>
    filter === 'out' ? m.lowest <= 0 : filter === 'low' ? m.lowest <= 2000 : true,
  );
  const models = showAll ? matching : matching.slice(0, GRID_FIRST);
  if (matching.length === 0) {
    return <p className="text-sm text-ink-muted">لا أصناف بمقاسات وألوان لتُعرض شبكة.</p>;
  }
  const isOpen = (id: string, index: number) => toggled.get(id) ?? index < 1;
  const flip = (id: string, index: number) => setToggled((now) => new Map(now).set(id, !isOpen(id, index)));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="الأصناف المعروضة"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: 'all', label: 'الكل' },
            { value: 'out', label: 'سالب أو نفد' },
            { value: 'low', label: 'قليل (2 أو أقل)' },
          ]}
        />
        {models.length > 4 ? (
          <span className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setToggled(new Map(models.map((m) => [m.id, true])))}>
              افتح الكل
            </Button>
            <Button variant="ghost" onClick={() => setToggled(new Map(models.map((m) => [m.id, false])))}>
              اطوِ الكل
            </Button>
          </span>
        ) : null}
      </div>
      <p className="text-xs text-ink-muted">
        الأحمر: نفد أو سالب (والسالب مكتوب بكلمته) · الأصفر: قليل (2 أو أقل) · «—»: لا توجد هذه القطعة.
      </p>
      {models.map((m, index) => {
        const grid = gridOf(m.pieces as never);
        if (!grid.fits) return null;
        // The totals are what can be sold: a piece below zero adds nothing, and is told apart as «سالب»
        const qtyOf = (v: unknown) => Math.max(0, (v as Piece).qty);
        const minus = m.pieces.reduce((n, p) => n + Math.max(0, -p.qty), 0);
        const minusIds = m.pieces.filter((p) => p.qty < 0).map((p) => p.variantId);
        const open = isOpen(m.id, index);
        const rowTotal = (row: string) =>
          grid.cols.reduce((n, col) => {
            const v = grid.cell(row, col);
            return v ? n + qtyOf(v) : n;
          }, 0);
        const colTotal = (col: string) =>
          grid.rows.reduce((n, row) => {
            const v = grid.cell(row, col);
            return v ? n + qtyOf(v) : n;
          }, 0);
        const total = grid.rows.reduce((n, row) => n + rowTotal(row), 0);
        const totalCell = 'num px-3 py-2.5 text-center text-sm font-bold text-ink-muted';
        return (
          <section key={m.id} aria-label={`شبكة ${m.name}`} className="flex flex-col gap-2">
            <h3 className="flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold text-ink">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => flip(m.id, index)}
                className="flex min-h-11 items-center gap-2 rounded-small text-start"
              >
                <span aria-hidden="true" className="text-ink-subtle">
                  {open ? <ChevDown size={20} /> : <ChevLeft size={20} />}
                </span>
                {m.name}
              </button>
              <span className="num text-sm font-normal text-ink-muted">
                متوفر {formatQuantity(total, numberFormat)}
              </span>
              {minus > 0 ? (
                <span className="text-sm font-semibold text-danger-ink">
                  <bdi>{negativePieces(minus / 1000, formatQuantity(minus, numberFormat))}</bdi>
                </span>
              ) : null}
              {minus > 0 && onCount && open ? (
                <span className="ms-auto">
                  <Button size="sm" variant="secondary" onClick={() => onCount(minusIds)}>
                    صحّح بالجرد
                  </Button>
                </span>
              ) : null}
            </h3>
            {open ? (
              <div className="relative overflow-x-auto">
                <table className="ix-gridtable border-separate border-spacing-1.5">
                  <thead>
                    <tr>
                      <th className="pe-3 text-start text-xs font-semibold whitespace-nowrap text-ink-subtle">
                        {grid.rowName}
                        {grid.colName ? ` ‏/ ${grid.colName}` : ''}
                      </th>
                      {grid.cols.map((col) => (
                        <th
                          key={col || '_'}
                          scope="col"
                          className="px-2 pb-1 text-center text-xs font-semibold whitespace-nowrap text-ink-subtle"
                        >
                          {col || 'الكمية'}
                        </th>
                      ))}
                      {grid.colName ? (
                        <th
                          scope="col"
                          className="px-2 pb-1 text-center text-xs font-semibold text-ink-subtle"
                        >
                          المجموع
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.rows.map((row) => (
                      <tr key={row}>
                        <th scope="row" className="pe-3 text-start font-semibold whitespace-nowrap text-ink">
                          {row}
                        </th>
                        {grid.cols.map((col) => {
                          const v = grid.cell(row, col);
                          if (!v) {
                            return (
                              <td
                                key={col || '_'}
                                className="min-w-16 rounded-small border border-dashed border-line text-center text-ink-subtle"
                              >
                                —
                              </td>
                            );
                          }
                          const rawQty = (v as unknown as Piece).qty;
                          const qty = rawQty;
                          return (
                            <td
                              key={col || '_'}
                              className={cn(
                                'num min-w-16 rounded-small px-3 py-2.5 text-center font-semibold',
                                qty < 0
                                  ? 'bg-danger-soft text-danger-ink ring-1 ring-danger'
                                  : qty === 0
                                    ? 'bg-danger-soft text-danger-ink'
                                    : qty <= 2000
                                      ? 'bg-warning-soft text-warning-ink'
                                      : 'bg-surface-muted text-ink',
                              )}
                            >
                              {rawQty < 0 ? (
                                <>
                                  سالب <bdi className="num">{formatQuantity(-rawQty, numberFormat)}</bdi>
                                </>
                              ) : (
                                formatQuantity(rawQty, numberFormat)
                              )}
                            </td>
                          );
                        })}
                        {grid.colName ? (
                          <td className={totalCell}>{formatQuantity(rowTotal(row), numberFormat)}</td>
                        ) : null}
                      </tr>
                    ))}
                    {grid.colName ? (
                      <tr>
                        <th scope="row" className="pe-3 text-start text-xs font-semibold text-ink-subtle">
                          المجموع
                        </th>
                        {grid.cols.map((col) => (
                          <td key={col || '_'} className={totalCell}>
                            {formatQuantity(colTotal(col), numberFormat)}
                          </td>
                        ))}
                        <td className={cn(totalCell, 'text-ink')}>{formatQuantity(total, numberFormat)}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        );
      })}
      {matching.length > GRID_FIRST ? (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => setShowAll((now) => !now)}>
            {showAll ? `اعرض أول ${GRID_FIRST} فقط` : `اعرض الكل (${matching.length})`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
