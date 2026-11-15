import { useEffect, useState } from 'react';
import type { ExpiryRow } from '@serva/core';
import { formatQuantity, Select, useDigits } from '@serva/ui';
import { dayText } from '../../lib/dates';
import { listBatchesOf } from './api';

/** A batch as a document line names it: the number and the expiry as received */
export interface BatchChoice {
  batchNo: string | null;
  expiryDate: string | null;
}

const keyOf = (b: BatchChoice) => `${b.batchNo ?? ''}|${b.expiryDate ?? ''}`;

/**
 * «الدفعة» of a line that takes pieces out (03 › الصيدليات): the batches the branch holds of this
 * item with what is left of each, or «الأقرب انتهاءً» to let the earliest expiry go first. An item
 * that keeps no batches shows nothing.
 */
export function BatchSelect({
  variantId,
  branchId,
  value,
  onChange,
  error,
}: {
  variantId: string;
  branchId: string | undefined;
  value: BatchChoice | null;
  onChange: (batch: BatchChoice | null) => void;
  error?: string | undefined;
}) {
  const digits = useDigits();
  const [rows, setRows] = useState<ExpiryRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    listBatchesOf(variantId, branchId)
      .then((r) => alive && setRows(r.items))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [variantId, branchId]);
  if (!rows || rows.length === 0) return null;
  // The no-batch row below zero is shown so the batches add up to the stock, but nothing can be returned from it
  const isNegativeNoBatch = (r: ExpiryRow) => !r.batchNo && !r.expiryDate && r.qty <= 0;
  const unbatched = rows.filter(isNegativeNoBatch);
  const batched = rows.filter((r) => !isNegativeNoBatch(r));
  return (
    <div className="flex flex-col gap-1">
      <Select
        label="الدفعة"
        value={value ? keyOf(value) : ''}
        error={error}
        onChange={(e) => {
          const row = rows.find(
            (r) => keyOf({ batchNo: r.batchNo, expiryDate: r.expiryDate }) === e.target.value,
          );
          onChange(row ? { batchNo: row.batchNo, expiryDate: row.expiryDate } : null);
        }}
      >
        <option value="">الأقرب انتهاءً أولاً</option>
        {batched.map((r) => (
          <option
            key={keyOf({ batchNo: r.batchNo, expiryDate: r.expiryDate })}
            value={keyOf({ batchNo: r.batchNo, expiryDate: r.expiryDate })}
          >
            {`${r.batchNo ?? 'بلا رقم'}${r.expiryDate ? ` · تنتهي ${dayText(r.expiryDate, digits)}` : ''} · المتبقي ${formatQuantity(r.qty, digits)}`}
          </option>
        ))}
        {unbatched.map((r) => (
          <option key="unbatched" value="__unbatched" disabled>
            {`بلا دفعة · ${formatQuantity(r.qty, digits)}`}
          </option>
        ))}
      </Select>
      {unbatched.map((r) => (
        <p key="note" className="text-xs text-ink-muted">
          بلا دفعة: <bdi className="num">{formatQuantity(r.qty, digits)}</bdi>، فلا تُرجَع من هنا، لكنها داخلة
          في مجموع المخزون.
        </p>
      ))}
    </div>
  );
}
