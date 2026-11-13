import { useState } from 'react';
import { type CurrencyCode } from '@serva/core';
import { Button, MoneyField, Select, Switch } from '@serva/ui';
import { SparklesIcon } from '@serva/ui';
import {
  applyToVariants,
  variantsWithoutBarcode,
  withGeneratedBarcodes,
  type Axis,
  type BulkField,
  type BulkScope,
  type VariantDraft,
} from './form';

const FIELDS: { field: BulkField; label: string }[] = [
  { field: 'priceMinor', label: 'سعر البيع' },
  { field: 'wholesalePriceMinor', label: 'سعر الجملة' },
  { field: 'minPriceMinor', label: 'السعر الأدنى للمفاصلة' },
];

interface BulkApplyProps {
  axes: readonly Axis[];
  variants: readonly VariantDraft[];
  currency: CurrencyCode;
  autoBarcode: boolean;
  onAutoBarcode: (on: boolean) => void;
  onChange: (variants: VariantDraft[]) => void;
}

/**
 * Entering a 15-row size × colour matrix by hand is the slow part of a new model: one price for
 * all of it (or for one colour or size), and one tap to give every variant a barcode.
 */
export function BulkApply({
  axes,
  variants,
  currency,
  autoBarcode,
  onAutoBarcode,
  onChange,
}: BulkApplyProps) {
  const [field, setField] = useState<BulkField>('priceMinor');
  const [scopeKey, setScopeKey] = useState('all');
  const [value, setValue] = useState<number | null>(null);
  const missing = variantsWithoutBarcode(variants);

  const scopes: { key: string; label: string; scope: BulkScope }[] = [
    { key: 'all', label: 'كل المتغيّرات', scope: { all: true } },
    ...axes.flatMap((a) =>
      a.values.map((v) => ({
        key: `${a.name}|${v}`,
        label: `${a.name}: ${v}`,
        scope: { name: a.name, value: v } as BulkScope,
      })),
    ),
  ];
  const chosen = scopes.find((s) => s.key === scopeKey) ?? scopes[0]!;

  return (
    <div className="flex flex-col gap-3 rounded-control border border-line bg-surface-muted p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Select
          label="الحقل"
          value={field}
          onChange={(e) => setField(e.target.value as BulkField)}
          className="w-44"
        >
          {FIELDS.map((f) => (
            <option key={f.field} value={f.field}>
              {f.label}
            </option>
          ))}
        </Select>
        <Select label="على" value={chosen.key} onChange={(e) => setScopeKey(e.target.value)} className="w-48">
          {scopes.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>
        <MoneyField
          key={`${currency}-${field}`}
          label="القيمة"
          currency={currency}
          valueMinor={value}
          onValueChange={setValue}
          className="w-44"
        />
        <Button
          variant="secondary"
          disabled={value === null}
          onClick={() => onChange(applyToVariants(variants, chosen.scope, field, value))}
        >
          طبّق على الكل
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          icon={<SparklesIcon />}
          disabled={missing === 0}
          onClick={() => onChange(withGeneratedBarcodes(variants))}
        >
          ولّد باركود للكل
        </Button>
        <span className="text-sm text-ink-muted">
          {missing === 0 ? 'لكل متغيّر باركود.' : `${String(missing)} بلا باركود. يُولَّد عند الحفظ.`}
        </span>
        <Switch
          label="ولّد باركود لكل متغيّر جديد عند الحفظ"
          checked={autoBarcode}
          onCheckedChange={onAutoBarcode}
        />
      </div>
    </div>
  );
}
