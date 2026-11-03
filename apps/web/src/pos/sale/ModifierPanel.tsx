import { useState } from 'react';
import type { CurrencyCode } from '@serva/core/currencies';
import { Alert, Button, Money, TextField, ToggleChip } from '@serva/ui';
import type { CatalogItem } from '../catalog';
import type { Choice, ItemChoice } from './cart';

/**
 * «الإضافات والخيارات» (03 › المطاعم، المقاهي): the item's groups of choices, beside the cart.
 * A group of one choice starts on its first option, so the usual order is two taps: the item, then
 * «أضف». A required group of several needs one at least. The note goes to the kitchen.
 */
export function ModifierPanel({
  item,
  onAdd,
  onCancel,
}: {
  item: CatalogItem;
  onAdd: (choice: ItemChoice) => void;
  onCancel: () => void;
}) {
  const groups = item.modifiers ?? [];
  const currency: CurrencyCode = item.price.currency;
  const [picked, setPicked] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(groups.map((g) => [g.name, g.multiple ? [] : [g.options[0]!.name]])),
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const choices: Choice[] = groups.flatMap((g) =>
    g.options
      .filter((o) => picked[g.name]?.includes(o.name))
      .map((o) => ({ group: g.name, name: o.name, priceMinor: o.priceMinor })),
  );
  const extra = choices.reduce((sum, c) => sum + c.priceMinor, 0);

  function toggle(group: string, option: string, multiple: boolean) {
    setError(null);
    setPicked((p) => {
      const now = p[group] ?? [];
      if (!multiple) return { ...p, [group]: [option] };
      return { ...p, [group]: now.includes(option) ? now.filter((o) => o !== option) : [...now, option] };
    });
  }

  function add() {
    const missing = groups.find((g) => g.required && (picked[g.name]?.length ?? 0) === 0);
    if (missing) {
      setError(`اختر من «${missing.name}».`);
      return;
    }
    onAdd({ choices, note: note.trim() || null });
  }

  return (
    <section
      aria-label={`خيارات ${item.name}`}
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4"
    >
      <h2 className="text-lg font-bold text-ink">{item.name}</h2>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {groups.map((g) => (
        <fieldset key={g.name} className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold text-ink">
            {g.name}
            {g.required ? <span className="ms-1 text-sm text-danger-ink">(مطلوب)</span> : null}
          </legend>
          <div className="flex flex-wrap gap-2">
            {g.options.map((o) => (
              <ToggleChip
                key={o.name}
                type={g.multiple ? 'checkbox' : 'radio'}
                name={`${item.variantId}-${g.name}`}
                label={
                  o.priceMinor > 0 ? `${o.name} +${(o.priceMinor / 100).toLocaleString('en-US')}` : o.name
                }
                checked={picked[g.name]?.includes(o.name) ?? false}
                onChange={() => toggle(g.name, o.name, g.multiple)}
              />
            ))}
          </div>
        </fieldset>
      ))}
      <TextField
        label="ملاحظة للمطبخ"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={60}
      />
      <div className="flex items-center gap-3">
        <Button onClick={add}>
          أضف
          {extra > 0 ? (
            <span className="ms-2">
              +<Money minor={extra} currency={currency} symbol={false} />
            </span>
          ) : null}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          إلغاء
        </Button>
      </div>
    </section>
  );
}
