import { useState } from 'react';
import type { CurrencyCode } from '@serva/core/currencies';
import { AddIcon, Alert, Badge, Button, CloseIcon, Money, TextField, ToggleChip } from '@serva/ui';
import type { CatalogItem } from '../catalog';
import type { Choice, ItemChoice } from './cart';
import { SalePanel } from './SalePanel';

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
    <SalePanel
      label={`خيارات ${item.name}`}
      title={item.name}
      subtitle={<Money minor={item.price.priceMinor} currency={currency} />}
      actions={
        <Button variant="secondary" size="md" icon={<CloseIcon size={20} />} onClick={onCancel}>
          إلغاء
        </Button>
      }
      footer={
        <Button size="lg" icon={<AddIcon size={20} />} onClick={add}>
          أضف
          {extra > 0 ? (
            <span className="ms-1">
              +<Money minor={extra} currency={currency} symbol={false} />
            </span>
          ) : null}
        </Button>
      }
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      {groups.map((g) => (
        <fieldset key={g.name} className="flex flex-col gap-3">
          <legend className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-muted">
            {g.name}
            {g.required ? <Badge tone="neutral">مطلوب</Badge> : null}
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
    </SalePanel>
  );
}
