import { useState, type Dispatch, type SetStateAction } from 'react';
import type { InventoryRow } from '@serva/core';
import { lookupBarcode } from '../catalog/api';
import { qtyOf } from './api';

/** Counting by scanning (03 › الألبسة: الجرد بالمسح): each scan adds one piece (or its pack) to the count. */
export function useInventoryScan(
  items: InventoryRow[],
  countItems: InventoryRow[],
  setCounts: Dispatch<SetStateAction<Record<string, string>>>,
) {
  const [scan, setScan] = useState('');
  const [scanned, setScanned] = useState<{ variantId: string; name: string } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  async function addScan() {
    const code = scan.trim();
    setScan('');
    if (!code) return;
    setScanError(null);
    try {
      const hit = await lookupBarcode(code);
      const row = countItems.find((r) => r.variantId === hit.variantId);
      if (!row) {
        const elsewhere = items.some((r) => r.variantId === hit.variantId);
        setScanned(null);
        setScanError(
          elsewhere
            ? `«${code}» ليس في مخزون هذا الفرع. اختر فرعه من الجرد أولاً.`
            : `لا صنف بالباركود ${code}.`,
        );
        return;
      }
      setCounts((c) => ({
        ...c,
        [hit.variantId]: String(((qtyOf(c[hit.variantId] ?? '') ?? 0) + hit.barcode.packQty) / 1000),
      }));
      setScanned({ variantId: hit.variantId, name: row.name });
      // The counted row comes into view and flashes once
      requestAnimationFrame(() => {
        const el = document.getElementById(`ix-row-${hit.variantId}`);
        el?.scrollIntoView?.({ block: 'center' });
        el?.classList.remove('ix-flash');
        void el?.offsetWidth;
        el?.classList.add('ix-flash');
      });
    } catch {
      setScanned(null);
      setScanError(`لا صنف بالباركود ${code}.`);
    }
  }

  return { scan, setScan, scanned, scanError, addScan };
}
