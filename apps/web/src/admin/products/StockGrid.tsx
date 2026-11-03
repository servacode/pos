import { useState } from 'react';
import type { ProductDetail } from '@serva/core';
import { cn, formatQuantity, Select } from '@serva/ui';
import { gridOf } from '../purchases/SizeGrid';

/**
 * «المخزون حسب المقاس واللون» (03 › الألبسة): what is left of each piece of a model, sizes down and
 * colours across, in every branch together or in one, so «في M أسود؟» is one look. Empty cells
 * are pieces never made; zero is a piece that ran out.
 */
export function StockGrid({
  product,
  numberFormat,
}: {
  product: ProductDetail;
  numberFormat: 'latn' | 'arab';
}) {
  const live = product.variants.filter((v) => !v.archivedAt);
  const grid = gridOf(live);
  const branches = new Map<string, string>();
  for (const v of live) for (const s of v.stock) branches.set(s.branchId, s.branchName);
  const [branch, setBranch] = useState<string>('all');
  if (live.length < 2 || !grid.fits) return null;
  const qtyOf = (v: (typeof live)[number]) =>
    v.stock.filter((s) => branch === 'all' || s.branchId === branch).reduce((n, s) => n + s.qty, 0);

  return (
    <div className="flex flex-col gap-3">
      {branches.size > 1 ? (
        <Select label="الفرع" value={branch} onChange={(e) => setBranch(e.target.value)} className="w-56">
          <option value="all">كل الفروع</option>
          {[...branches].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      ) : null}
      <div className="overflow-x-auto">
        <table aria-label="المخزون حسب المقاس واللون" className="border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="text-start text-sm text-ink-muted">
                {grid.rowName}
                {grid.colName ? ` \\ ${grid.colName}` : ''}
              </th>
              {grid.cols.map((col) => (
                <th key={col || '_'} scope="col" className="px-2 text-sm font-semibold">
                  {col || 'الكمية'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row}>
                <th scope="row" className="pe-2 text-start font-semibold">
                  {row}
                </th>
                {grid.cols.map((col) => {
                  const v = grid.cell(row, col);
                  if (!v) {
                    return (
                      <td key={col || '_'} className="min-w-14 text-center text-ink-muted">
                        —
                      </td>
                    );
                  }
                  const qty = qtyOf(v);
                  return (
                    <td
                      key={col || '_'}
                      aria-label={`${v.label ?? row}: ${formatQuantity(qty, numberFormat)}`}
                      className={cn(
                        'num min-w-14 rounded-control px-2 py-2 text-center font-semibold',
                        qty <= 0 ? 'bg-danger-soft text-danger-ink' : 'bg-surface-muted text-ink',
                      )}
                    >
                      {formatQuantity(qty, numberFormat)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
