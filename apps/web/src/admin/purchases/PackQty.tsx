import { QTY_SCALE, type PackOption } from '@serva/core';
import { Select, TextField } from '@serva/ui';

/**
 * The quantity of a document line with the unit it is typed in: pieces, or a pack the item has
 * («علبة 100»). The pick shows only for an item that has packs; the pieces it comes to are shown
 * by the line, never typed twice.
 */
export function PackQty({
  name,
  packs,
  qty,
  packQty,
  onChange,
  error,
}: {
  name: string;
  packs: readonly PackOption[] | undefined;
  qty: string;
  packQty: number;
  onChange: (patch: { qty?: string; packQty?: number }) => void;
  error?: string | undefined;
}) {
  return (
    <div className="flex items-start gap-2">
      <TextField
        label={`كمية ${name}`}
        hideLabel
        inputMode="decimal"
        dir="ltr"
        value={qty}
        onChange={(e) => onChange({ qty: e.target.value })}
        error={error}
        className="min-w-0 flex-1"
        inputClassName="num"
      />
      {packs && packs.length > 0 ? (
        <Select
          label={`وحدة ${name}`}
          hideLabel
          value={String(packQty)}
          onChange={(e) => onChange({ packQty: Number(e.target.value) })}
          className="w-28 shrink-0"
        >
          <option value={QTY_SCALE}>قطعة</option>
          {packs.map((p) => (
            <option key={p.qty} value={p.qty}>
              {p.name} {p.qty / QTY_SCALE}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  );
}
