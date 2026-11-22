import { useEffect, useState } from 'react';
import type { SupplierDueResponse, SupplierDueRow } from '@serva/core';
import { listSupplierDues } from './api';

/**
 * Round 64: every open supplier invoice that has a due date, read once for the page (the due panel, the due column and the
 * suppliers table all draw from it). null until read, and when the read fails (the pages work without it).
 */
export function useSupplierDues(tick = 0): SupplierDueResponse | null {
  const [dues, setDues] = useState<SupplierDueResponse | null>(null);
  useEffect(() => {
    let alive = true;
    listSupplierDues(7, true).then(
      (r) => alive && setDues(r),
      () => alive && setDues(null),
    );
    return () => {
      alive = false;
    };
  }, [tick]);
  return dues;
}

/** The open invoices by id, for a table to mark its rows */
export function dueById(dues: SupplierDueResponse | null): Map<string, SupplierDueRow> {
  return new Map((dues?.items ?? []).map((d) => [d.purchaseId, d]));
}

/** The nearest open due date and what is overdue, for each supplier */
export function dueBySupplier(
  dues: SupplierDueResponse | null,
): Map<string, { dueDate: string; overdueDays: number; openMinor: number }> {
  const out = new Map<string, { dueDate: string; overdueDays: number; openMinor: number }>();
  for (const d of dues?.items ?? []) {
    const seen = out.get(d.supplierId);
    if (!seen)
      out.set(d.supplierId, { dueDate: d.dueDate, overdueDays: d.overdueDays, openMinor: d.openMinor });
    else out.set(d.supplierId, { ...seen, openMinor: seen.openMinor + d.openMinor });
  }
  return out;
}
