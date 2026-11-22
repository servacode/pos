import { useState } from 'react';
import { wasteReasonsOf, type InventoryResponse, type InventoryRow, type StocktakeDetail } from '@serva/core';
import { formatQuantity, type Digits } from '@serva/ui';
import { errorMessage } from '../../lib/api';
import { sortByOptions } from '../../lib/optionOrder';
import { createStocktake, newDocumentId, qtyOf, storeToday } from './api';

/**
 * «سجّل هدراً» (03 › الخضار والمخابز: تسجيل الهدر): what spoiled, out of stock at its cost. Round 38: why it was thrown
 * away; the picker narrows by typing and the write-off is confirmed first; a tracked product names its serial numbers.
 */
export function useInventoryWaste({
  items,
  stock,
  branchList,
  firstBranch,
  digits,
  timeZone,
  setSaving,
  setError,
  setResult,
  load,
  loadPast,
}: {
  items: InventoryRow[];
  stock: InventoryResponse | null;
  branchList: { id: string; name: string }[];
  firstBranch: string;
  digits: Digits;
  timeZone: string;
  setSaving: (v: boolean) => void;
  setError: (v: string | null) => void;
  setResult: (v: StocktakeDetail | null) => void;
  load: () => void;
  loadPast: (cursor: string | null) => void;
}) {
  const [wasteKey, setWasteKey] = useState('');
  const [wasteQty, setWasteQty] = useState('');
  // Why it was thrown away (round 38): the store's reasons, kept on the count's line for the waste report
  const [wasteWhy, setWasteWhy] = useState('');
  // The picker narrows by typing (a store has hundreds of pieces); the write-off is confirmed first
  const [wasteQuery, setWasteQuery] = useState('');
  const [wasteAsk, setWasteAsk] = useState(false);
  const [wasteId, setWasteId] = useState(newDocumentId);
  // What went wrong with the waste: told inside its window, not behind it
  const [wasteError, setWasteError] = useState<string | null>(null);
  // Which serial numbers left, for a tracked product that was written off
  const [wasteSerials, setWasteSerials] = useState<string[]>([]);
  // «سجّل هدراً» opens from a button, in a window of its own
  const [wasteOpen, setWasteOpen] = useState(false);

  const wasteRow = items.find((r) => `${r.branchId}:${r.variantId}` === wasteKey);
  // Pieces of one item keep a fixed branch order: the main branch (the first code) first, the rest by name
  const branchRank = new Map(
    [...branchList]
      .sort(
        (a, b) =>
          Number(b.id === firstBranch) - Number(a.id === firstBranch) || a.name.localeCompare(b.name, 'ar'),
      )
      .map((b, i) => [b.id, i]),
  );
  const byBranch = [...items].sort(
    (a, b) => (branchRank.get(a.branchId) ?? 0) - (branchRank.get(b.branchId) ?? 0),
  );
  const wasteOptions = sortByOptions(byBranch).filter((r) => {
    const typed = wasteQuery.trim().toLowerCase();
    return !typed || `${r.branchId}:${r.variantId}` === wasteKey || r.name.toLowerCase().includes(typed);
  });
  /** What is wrong with the typed waste, or null: nothing leaves that is not on the shelf */
  function wasteProblem(): string | null {
    const qty = qtyOf(wasteQty);
    if (!wasteRow || !qty || qty <= 0) return 'اختر الصنف واكتب كمية الهدر.';
    if (wasteRow.qty <= 0) return 'لا مخزون لهذا الصنف ليخرج منه هدر.';
    // A piece item is counted in whole pieces; only a weighed one takes a fraction
    if (wasteRow.allowsFraction === false && qty % 1000 !== 0) {
      return 'هذا الصنف يُعدّ بالقطعة: اكتب عدداً صحيحاً.';
    }
    if (qty > wasteRow.qty) {
      return `الموجود من هذا الصنف ${formatQuantity(wasteRow.qty, digits)} فقط. اكتب كمية أقل.`;
    }
    if (wasteRow.tracksSerial && wasteSerials.length !== Math.ceil(qty / 1000)) {
      return `هذا الصنف له أرقام تسلسلية: اختر ${Math.ceil(qty / 1000)} رقماً للقطع التالفة.`;
    }
    return null;
  }

  function askWaste() {
    const problem = wasteProblem();
    setWasteError(problem);
    setWasteAsk(!problem);
  }

  function openWaste() {
    setWasteError(null);
    setWasteOpen(true);
  }

  async function saveWaste() {
    const row = wasteRow;
    const qty = qtyOf(wasteQty);
    setWasteAsk(false);
    const problem = wasteProblem();
    if (problem || !row || !qty) {
      setWasteError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    setWasteError(null);
    try {
      setResult(
        await createStocktake({
          id: wasteId,
          branchId: row.branchId,
          date: storeToday(timeZone),
          // The write-off is worked out from the list the owner is looking at: what moved after it is counted
          ...(stock?.asOf ? { countedAt: stock.asOf } : {}),
          note: 'هدر',
          lines: [
            {
              variantId: row.variantId,
              countedQty: Math.max(0, row.qty - qty),
              wasteReason: wasteWhy || wasteReasonsOf(stock?.wasteReasons)[0]!,
              ...(row.tracksSerial && wasteSerials.length > 0 ? { serials: wasteSerials } : {}),
            },
          ],
        }),
      );
      setWasteKey('');
      setWasteSerials([]);
      setWasteQty('');
      setWasteQuery('');
      setWasteId(newDocumentId());
      setWasteOpen(false);
      load();
      loadPast(null);
    } catch (e) {
      setWasteError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return {
    wasteKey,
    setWasteKey,
    wasteQty,
    setWasteQty,
    wasteWhy,
    setWasteWhy,
    wasteQuery,
    setWasteQuery,
    wasteAsk,
    setWasteAsk,
    wasteError,
    setWasteError,
    wasteSerials,
    setWasteSerials,
    wasteOpen,
    setWasteOpen,
    wasteRow,
    wasteOptions,
    askWaste,
    saveWaste,
    openWaste,
  };
}

export type InventoryWaste = ReturnType<typeof useInventoryWaste>;
