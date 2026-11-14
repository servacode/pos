import { memo, useState } from 'react';
import type { ProductDetail } from '@serva/core';
import { cn, formatQuantity, GridIcon, Select } from '@serva/ui';
import { gridOf } from '../purchases/SizeGrid';
import { SectionCard } from './parts';

/**
 * «المخزون حسب المقاس واللون» (03 › الألبسة): what is left of each piece of a model, sizes down and
 * colours across, in every branch together or in one, so «في M أسود؟» is one look. Empty cells
 * are pieces never made; zero is a piece that ran out. A card of its own, or nothing for a product
 * of one piece.
 */
export const StockGrid = memo(function StockGrid({
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
    <SectionCard
      title="المخزون حسب المقاس واللون"
      icon={<GridIcon />}
      description="ما بقي من كل قطعة. الخانة الفارغة قطعة لم تُصنع، والصفر قطعة نفدت."
      action={
        branches.size > 1 ? (
          <Select
            label="الفرع"
            hideLabel
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="w-48"
          >
            <option value="all">كل الفروع</option>
            {[...branches].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        ) : undefined
      }
    >
      {/* `relative` keeps hidden text inside the sideways scroll on a phone. */}
      <div className="relative -mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
        <table aria-label="المخزون حسب المقاس واللون" className="border-separate border-spacing-1.5">
          <thead>
            <tr>
              <th className="pe-3 text-start text-xs font-semibold whitespace-nowrap text-ink-subtle">
                {grid.rowName}
                {grid.colName ? ` \\ ${grid.colName}` : ''}
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
                      aria-label={`${v.label ?? row}: ${formatQuantity(qty, numberFormat)}`}
                      className={cn(
                        'num min-w-16 rounded-small px-3 py-2.5 text-center font-semibold',
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
    </SectionCard>
  );
});
