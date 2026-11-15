import type { InventoryRow } from '@serva/core';
import { cn, formatQuantity } from '@serva/ui';
import { gridOf } from './SizeGrid';

type Piece = Pick<InventoryRow, 'variantId' | 'qty'> & { attributes: { name: string; value: string }[] };

/**
 * The stock of every model that has sizes and colours, as one small grid each: sizes down, colours
 * across, the quantity in each cell (every branch shown, added together). A piece the list has no
 * options for stays in the list view.
 */
export function InventoryGrid({
  rows,
  numberFormat,
}: {
  rows: readonly InventoryRow[];
  numberFormat: 'latn' | 'arab';
}) {
  const byProduct = new Map<string, { name: string; pieces: Map<string, Piece> }>();
  for (const r of rows) {
    if (!r.productId || !r.attributes || r.attributes.length === 0) continue;
    const model = byProduct.get(r.productId) ?? { name: r.productName ?? r.name, pieces: new Map() };
    const piece = model.pieces.get(r.variantId);
    if (piece) piece.qty += r.qty;
    else model.pieces.set(r.variantId, { variantId: r.variantId, qty: r.qty, attributes: r.attributes });
    byProduct.set(r.productId, model);
  }
  const models = [...byProduct.entries()]
    .map(([id, m]) => {
      const pieces = [...m.pieces.values()];
      return { id, name: m.name, pieces, lowest: Math.min(...pieces.map((p) => p.qty)) };
    })
    // The models with the thinnest size first: that is the one to restock
    .sort((a, b) => a.lowest - b.lowest || a.name.localeCompare(b.name, 'ar'));
  if (models.length === 0) {
    return <p className="text-sm text-ink-muted">لا أصناف بمقاسات وألوان لتُعرض شبكة.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {models.map((m) => {
        const grid = gridOf(m.pieces as never);
        if (!grid.fits) return null;
        const qtyOf = (v: unknown) => (v as Piece).qty;
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
            <h3 className="font-semibold text-ink">{m.name}</h3>
            <div className="relative overflow-x-auto">
              <table className="border-separate border-spacing-1.5">
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
                      <th scope="col" className="px-2 pb-1 text-center text-xs font-semibold text-ink-subtle">
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
                        const qty = qtyOf(v);
                        return (
                          <td
                            key={col || '_'}
                            className={cn(
                              'num min-w-16 rounded-small px-3 py-2.5 text-center font-semibold',
                              qty <= 0 ? 'bg-danger-soft text-danger-ink' : 'bg-surface-muted text-ink',
                            )}
                          >
                            {formatQuantity(qty, numberFormat)}
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
          </section>
        );
      })}
    </div>
  );
}
