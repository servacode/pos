import { useState, type Dispatch, type SetStateAction } from 'react';
import { Link } from 'react-router';
import type { InventoryResponse, InventoryRow } from '@serva/core';
import { Button, formatQuantity, StockIcon, TextField, type Digits } from '@serva/ui';
import { Paged } from '../pager';
import { Amt, StatusPill, SxTable, type SxColumn } from '../sales/ui';
import { countProblem } from './stocktakeReview';
import { belowReorder } from './inventoryShared';

/** The rows a phone shows before «اعرض الكل» */
const PHONE_FIRST = 15;

/** The stock list: a table on a wide screen, cards on a phone; with a count box on each row while counting. */
export function InventoryList({
  shown,
  items,
  stock,
  error,
  counting,
  pagerKey,
  phone,
  manyBranches,
  branchLabel,
  base,
  digits,
  counts,
  setCounts,
  driftIds,
}: {
  shown: InventoryRow[];
  items: InventoryRow[];
  stock: InventoryResponse | null;
  error: string | null;
  counting: boolean;
  /** Changes when the filter, search, branch, order or count mode changes: the pager goes back to page one */
  pagerKey: string;
  phone: boolean;
  manyBranches: boolean;
  branchLabel: (r: Pick<InventoryRow, 'branchId' | 'branchName' | 'branchKind'>) => string;
  base: InventoryResponse['baseCurrency'];
  digits: Digits;
  counts: Record<string, string>;
  /** Products whose serial numbers do not match their stock: a mark on their row */
  driftIds?: ReadonlySet<string>;
  setCounts: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  // A phone folds a long list to its first rows; the choice lasts until the filter, search or order changes
  const [openKey, setOpenKey] = useState('');
  const folded = phone && !counting && openKey !== pagerKey && shown.length > PHONE_FIRST;
  const stateOf = (r: InventoryRow) =>
    r.qty < 0 ? (
      <StatusPill kind="danger">سالب</StatusPill>
    ) : r.qty === 0 ? (
      <StatusPill kind="danger">نفد</StatusPill>
    ) : null;
  const qtyCell = (r: InventoryRow) => (
    <span className="inline-flex items-center gap-2">
      {stateOf(r)}
      <span className="flex flex-col items-end">
        <bdi dir="ltr" className="sx-n">
          {formatQuantity(r.qty, digits)}
        </bdi>
        {r.sellableQty !== undefined && r.qty > 0 && r.sellableQty < r.qty ? (
          <span className="sx-subline">
            متوفر <bdi className="sx-n">{formatQuantity(r.sellableQty, digits)}</bdi>
          </span>
        ) : null}
      </span>
    </span>
  );
  const unitCell = (r: InventoryRow) =>
    r.unitCostMinor === null || r.unitCostMinor === 0 ? (
      <span className="sx-sub" title="الكلفة غير مسجلة">
        —
      </span>
    ) : (
      <Amt minor={Math.round(r.unitCostMinor)} currency={base} className="sx-mute" />
    );
  const countInput = (r: InventoryRow) => (
    <TextField
      label={`المعدود من ${r.name}`}
      hideLabel
      inputMode="decimal"
      dir="ltr"
      placeholder="—"
      value={counts[r.variantId] ?? ''}
      onChange={(e) => setCounts((c) => ({ ...c, [r.variantId]: e.target.value }))}
      error={countProblem(counts[r.variantId] ?? '') ?? undefined}
      className="ix-counted"
      inputClassName="num"
    />
  );

  const columns: SxColumn<InventoryRow>[] = [
    ...(counting
      ? [
          {
            key: 'counted',
            header: 'المعدود',
            cell: (r: InventoryRow) => <span id={`ix-row-${r.variantId}`}>{countInput(r)}</span>,
          } satisfies SxColumn<InventoryRow>,
        ]
      : []),
    {
      key: 'name',
      header: 'الصنف',
      lead: true,
      cell: (r) => (
        <>
          {r.name}
          {driftIds?.has(r.variantId) ? (
            <StatusPill kind="warn" className="ix-drift">
              أرقامه لا تطابق المخزون
            </StatusPill>
          ) : null}
          {manyBranches ? <span className="sx-subline">{branchLabel(r)}</span> : null}
        </>
      ),
    },
    { key: 'qty', header: 'الكمية', numeric: true, cell: qtyCell },
    { key: 'unit', header: 'كلفة الوحدة', numeric: true, cell: unitCell },
    ...(counting
      ? []
      : [
          {
            key: 'reorder',
            header: 'حد الطلب',
            numeric: true,
            hideBelowLg: true,
            cell: (r: InventoryRow) =>
              r.minStockQty ? (
                <span className="inline-flex items-center gap-2">
                  {belowReorder(r) ? <StatusPill kind="warn">تحت الحد</StatusPill> : null}
                  <bdi dir="ltr" className="sx-n">
                    {formatQuantity(r.minStockQty, digits)}
                  </bdi>
                </span>
              ) : (
                <span className="sx-sub">—</span>
              ),
          } satisfies SxColumn<InventoryRow>,
        ]),
    {
      key: 'value',
      header: 'القيمة',
      numeric: true,
      strong: true,
      cell: (r) => <Amt minor={r.valueMinor} currency={base} />,
    },
  ];

  return (
    <Paged
      key={pagerKey}
      rows={folded ? shown.slice(0, PHONE_FIRST) : shown}
      size={counting ? 100000 : 50}
      noun="الأصناف"
      render={(page) => (
        <>
          {phone && page.length > 0 ? (
            <ul className="sx-cards" aria-label="المخزون على الهاتف">
              {page.map((r) => (
                <li key={`${r.branchId}:${r.variantId}`} className="ix-icard" id={`ix-card-${r.variantId}`}>
                  <span className="n">
                    {r.name}
                    {driftIds?.has(r.variantId) ? (
                      <StatusPill kind="warn" className="ix-drift">
                        أرقامه لا تطابق المخزون
                      </StatusPill>
                    ) : null}
                    {manyBranches ? <span className="sx-subline">{branchLabel(r)}</span> : null}
                  </span>
                  <span className="v">
                    <Amt minor={r.valueMinor} currency={base} />
                  </span>
                  <span className="q">{qtyCell(r)}</span>
                  <span className="u">{unitCell(r)}</span>
                  {counting ? <span className="c">{countInput(r)}</span> : null}
                </li>
              ))}
              {folded ? (
                <li className="ix-more">
                  <Button variant="secondary" onClick={() => setOpenKey(pagerKey)}>
                    اعرض الكل ({shown.length})
                  </Button>
                </li>
              ) : null}
            </ul>
          ) : (
            <SxTable
              caption="المخزون"
              columns={columns}
              rows={page}
              rowKey={(r) => `${r.branchId}:${r.variantId}`}
              loading={!stock && !error}
              empty={
                items.length > 0 ? (
                  <div className="ix-empty">
                    <StockIcon size={32} />
                    <h3>لا صنف يطابق البحث.</h3>
                    <p>جرّب اسماً آخر أو فرعاً آخر.</p>
                  </div>
                ) : (
                  <div className="ix-empty">
                    <StockIcon size={32} />
                    <h3>لا مخزون بعد.</h3>
                    <p>سجّل فاتورة شراء فيدخل المخزون بكلفته.</p>
                    <Link to="/purchases" className="sx-fbtn">
                      سجّل فاتورة شراء
                    </Link>
                  </div>
                )
              }
            />
          )}
        </>
      )}
    />
  );
}
