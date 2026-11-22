import { memo } from 'react';
import type { CurrencyCode, ModifierGroup } from '@serva/core';
import { AddIcon, Button, DeleteIcon, IconButton, MoneyField, Switch, TextField } from '@serva/ui';

/**
 * «الإضافات والخيارات» on the product card (03 › المطاعم، المقاهي): groups such as «الحجم» (one
 * choice) or «الإضافات» (several), each option with what it adds to the price. Empty for most
 * products; the till then adds the item at once.
 */
export const ModifiersEditor = memo(function ModifiersEditor({
  groups,
  currency,
  disabled,
  onChange,
}: {
  groups: readonly ModifierGroup[];
  currency: CurrencyCode;
  disabled?: boolean;
  onChange: (groups: ModifierGroup[]) => void;
}) {
  const set = (i: number, patch: Partial<ModifierGroup>) =>
    onChange(groups.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  return (
    <div className="flex flex-col gap-4">
      {groups.length === 0 ? (
        <p className="text-sm text-ink-muted">
          لا خيارات بعد، فيضيفه الكاشير مباشرة. أضف مجموعة مثل «الحجم» أو «الإضافات» ليختار منها الزبون.
        </p>
      ) : null}
      {groups.map((group, i) => (
        <div key={i} className="rounded-control border border-line bg-surface p-4">
          <fieldset className="flex min-w-0 flex-col gap-4">
            <legend className="mb-4 font-semibold text-ink">{group.name || `مجموعة ${i + 1}`}</legend>
            <div className="flex flex-wrap items-end gap-3">
              <TextField
                label="اسم المجموعة"
                value={group.name}
                disabled={disabled}
                onChange={(e) => set(i, { name: e.target.value })}
                className="min-w-48 flex-1"
              />
              <Button
                variant="ghost"
                icon={<DeleteIcon />}
                disabled={disabled}
                onClick={() => onChange(groups.filter((_, k) => k !== i))}
              >
                احذف المجموعة
              </Button>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-1">
              <Switch
                label="يختار أكثر من خيار"
                checked={group.multiple}
                disabled={disabled}
                onCheckedChange={(multiple) => set(i, { multiple })}
              />
              <Switch
                label="مطلوب"
                checked={group.required}
                disabled={disabled}
                onCheckedChange={(required) => set(i, { required })}
              />
            </div>
            <div className="flex flex-col gap-3 border-t border-line pt-4">
              {group.options.map((option, j) => (
                <div key={j} className="flex flex-wrap items-end gap-3">
                  <TextField
                    label="الخيار"
                    value={option.name}
                    disabled={disabled}
                    onChange={(e) =>
                      set(i, {
                        options: group.options.map((o, k) => (k === j ? { ...o, name: e.target.value } : o)),
                      })
                    }
                    className="min-w-40 flex-1"
                  />
                  <MoneyField
                    label="يزيد السعر"
                    currency={currency}
                    valueMinor={option.priceMinor}
                    disabled={disabled}
                    onValueChange={(priceMinor) =>
                      set(i, {
                        options: group.options.map((o, k) =>
                          k === j ? { ...o, priceMinor: priceMinor ?? 0 } : o,
                        ),
                      })
                    }
                    className="w-40"
                  />
                  <IconButton
                    label={`احذف ${option.name || 'الخيار'}`}
                    icon={<DeleteIcon />}
                    disabled={disabled || group.options.length === 1}
                    onClick={() => set(i, { options: group.options.filter((_, k) => k !== j) })}
                  />
                </div>
              ))}
              <Button
                variant="ghost"
                icon={<AddIcon />}
                disabled={disabled}
                onClick={() => set(i, { options: [...group.options, { name: '', priceMinor: 0 }] })}
                className="self-start"
              >
                خيار آخر
              </Button>
            </div>
          </fieldset>
        </div>
      ))}
      <Button
        variant="secondary"
        icon={<AddIcon />}
        disabled={disabled}
        onClick={() =>
          onChange([
            ...groups,
            { name: '', multiple: false, required: false, options: [{ name: '', priceMinor: 0 }] },
          ])
        }
        className="self-start"
      >
        مجموعة خيارات
      </Button>
    </div>
  );
});
