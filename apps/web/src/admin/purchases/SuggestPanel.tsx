import { useMemo, useState } from 'react';
import type { PurchaseOrderSuggestionLine } from '@serva/core';
import { Badge, Button, Checkbox, formatQuantity, ToggleChip, useDigits } from '@serva/ui';

/** The suggested items of one model: its sizes and colours stay together */
export interface SuggestGroup {
  productId: string;
  name: string;
  items: PurchaseOrderSuggestionLine[];
}

/** Items grouped by their product, in the order the suggestion gave them */
export function groupSuggestion(items: readonly PurchaseOrderSuggestionLine[]): SuggestGroup[] {
  const groups = new Map<string, SuggestGroup>();
  for (const item of items) {
    const group = groups.get(item.productId) ?? {
      productId: item.productId,
      name: item.productName,
      items: [],
    };
    group.items.push(item);
    groups.set(item.productId, group);
  }
  return [...groups.values()];
}

/** When a model is told apart by exactly two things (size and colour), its two lists of values; else null */
export function gridAxes(items: readonly PurchaseOrderSuggestionLine[]) {
  const names = [...new Set(items.flatMap((i) => i.attributes.map((a) => a.name)))];
  if (names.length !== 2 || items.some((i) => i.attributes.length !== 2)) return null;
  const [rowName, colName] = names as [string, string];
  const value = (i: PurchaseOrderSuggestionLine, name: string) =>
    i.attributes.find((a) => a.name === name)?.value ?? '';
  const rows = [...new Set(items.map((i) => value(i, rowName)))];
  const cols = [...new Set(items.map((i) => value(i, colName)))];
  const at = new Map(items.map((i) => [`${value(i, rowName)}\u0000${value(i, colName)}`, i]));
  return { rowName, colName, rows, cols, at };
}

/**
 * «اقترح طلبية» for a shop with many sizes and colours: the suggestion grouped by model, each a
 * grid of sizes and colours (or a short list), every cell ticked by default; «حدد الكل» ticks or
 * clears a model, or the whole list. Only the ticked ones are added to the order.
 */
export function SuggestPanel({
  items,
  onAdd,
  onCancel,
}: {
  items: PurchaseOrderSuggestionLine[];
  onAdd: (picked: PurchaseOrderSuggestionLine[]) => void;
  onCancel: () => void;
}) {
  const digits = useDigits();
  const groups = useMemo(() => groupSuggestion(items), [items]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.map((i) => i.variantId)));
  const toggle = (ids: string[], on: boolean) =>
    setPicked((now) => {
      const next = new Set(now);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const everyId = items.map((i) => i.variantId);
  const count = (ids: string[]) => ids.filter((id) => picked.has(id)).length;
  const allCount = count(everyId);

  return (
    <div
      role="group"
      aria-label="الأصناف المقترحة"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface-muted/40 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Checkbox
          label={`حدد الكل (${formatQuantity(allCount * 1000, digits)} من ${formatQuantity(items.length * 1000, digits)})`}
          checked={allCount === items.length}
          indeterminate={allCount > 0 && allCount < items.length}
          onChange={(e) => toggle(everyId, e.target.checked)}
        />
        <span className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            لا أريدها
          </Button>
          <Button
            type="button"
            disabled={allCount === 0}
            onClick={() => onAdd(items.filter((i) => picked.has(i.variantId)))}
          >
            أضف المحدد إلى الطلبية
          </Button>
        </span>
      </div>
      <ul className="flex flex-col gap-4">
        {groups.map((g) => {
          const ids = g.items.map((i) => i.variantId);
          const some = count(ids);
          const axes = g.items.length > 1 ? gridAxes(g.items) : null;
          return (
            <li
              key={g.productId}
              className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3"
            >
              <Checkbox
                label={<span className="font-semibold">{g.name}</span>}
                description={`${formatQuantity(g.items.length * 1000, digits)} من الأصناف · الكمية ${formatQuantity(
                  g.items.reduce((n, i) => n + i.suggestedQty, 0),
                  digits,
                )}`}
                checked={some === ids.length}
                indeterminate={some > 0 && some < ids.length}
                onChange={(e) => toggle(ids, e.target.checked)}
              />
              {axes ? (
                <div className="max-w-full overflow-x-auto">
                  <table className="border-collapse text-sm" aria-label={`مقاسات وألوان ${g.name}`}>
                    <thead>
                      <tr>
                        <th scope="col" className="p-1 text-start text-xs font-semibold text-ink-subtle">
                          {axes.rowName} / {axes.colName}
                        </th>
                        {axes.cols.map((c) => (
                          <th key={c} scope="col" className="p-1 text-xs font-semibold text-ink-subtle">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {axes.rows.map((r) => (
                        <tr key={r}>
                          <th scope="row" className="p-1 text-start text-xs font-semibold text-ink-subtle">
                            {r}
                          </th>
                          {axes.cols.map((c) => {
                            const cell = axes.at.get(`${r}\u0000${c}`);
                            return (
                              <td key={c} className="p-1 text-center">
                                {cell ? (
                                  <ToggleChip
                                    label={formatQuantity(cell.suggestedQty, digits)}
                                    aria-label={`${cell.name}: ${formatQuantity(cell.suggestedQty, digits)}`}
                                    checked={picked.has(cell.variantId)}
                                    onChange={(e) => toggle([cell.variantId], e.target.checked)}
                                  />
                                ) : (
                                  <span className="text-ink-subtle">·</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {g.items.map((i) => (
                    <li key={i.variantId}>
                      <ToggleChip
                        label={`${i.name.replace(g.name, '').trim() || i.name} × ${formatQuantity(i.suggestedQty, digits)}`}
                        aria-label={`${i.name}: ${formatQuantity(i.suggestedQty, digits)}`}
                        checked={picked.has(i.variantId)}
                        onChange={(e) => toggle([i.variantId], e.target.checked)}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {g.items.some((i) => i.costDoubtful) ? (
                <Badge tone="warning">آخر كلفة لبعضها تبدو غير معتادة، راجعها بعد الإضافة</Badge>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
