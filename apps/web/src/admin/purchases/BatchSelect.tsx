import { useEffect, useState } from 'react';
import type { ExpiryRow } from '@serva/core';
import { formatQuantity, Select, useDigits } from '@serva/ui';
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
  return (
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
      {rows.map((r) => (
        <option
          key={keyOf({ batchNo: r.batchNo, expiryDate: r.expiryDate })}
          value={keyOf({ batchNo: r.batchNo, expiryDate: r.expiryDate })}
        >
          {`${r.batchNo ?? 'بلا رقم'}${r.expiryDate ? ` · تنتهي ${r.expiryDate}` : ''} · المتبقي ${formatQuantity(r.qty, digits)}`}
        </option>
      ))}
    </Select>
  );
}
