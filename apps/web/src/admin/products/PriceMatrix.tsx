import { memo, useState } from 'react';
import type { CurrencyCode } from '@serva/core';
import { Button, MoneyField, Switch } from '@serva/ui';
import { LiraCaption } from '../../lib/LiraCaption';
import { applyToVariants, variantsWithoutBarcode, type Axis, type VariantDraft } from './form';

/** The cell of a row value and a column value, or null (a combination never made) */
function cellOf(
  variants: readonly VariantDraft[],
  rowAxis: Axis,
  row: string,
  colAxis: Axis | null,
  col: string,
) {
  return (
    variants.find(
      (v) =>
        !v.archived &&
        v.attributes.some((a) => a.name === rowAxis.name && a.value === row) &&
        (!colAxis || v.attributes.some((a) => a.name === colAxis.name && a.value === col)),
    ) ?? null
  );
}

/** Whether the live variants can be laid out as one grid of prices: one or two options, one currency. */
export function matrixFits(axes: readonly Axis[], variants: readonly VariantDraft[]): boolean {
  const live = variants.filter((v) => !v.archived);
  return (
    axes.length >= 1 &&
    axes.length <= 2 &&
    live.length > 1 &&
    new Set(live.map((v) => v.currency)).size === 1 &&
    axes.every((a) => a.values.length > 0)
  );
}

/**
 * «الأسعار» as a grid, sizes down and colours across (03 › الألبسة): the price of every piece is one
 * cell to type in, and «السعر نفسه لكل المتغيّرات» fills them all at once. The floor price, the
 * wholesale price, the minimum and the barcodes stay in the detailed list behind its button.
 */
export const PriceMatrix = memo(function PriceMatrix({
  axes,
  variants,
  currency,
  autoBarcode,
  onAutoBarcode,
  onChange,
}: {
  axes: readonly Axis[];
  variants: readonly VariantDraft[];
  currency: CurrencyCode;
  autoBarcode: boolean;
  onAutoBarcode: (on: boolean) => void;
  onChange: (variants: VariantDraft[]) => void;
}) {
  const [same, setSame] = useState<number | null>(null);
  const rowAxis = axes[0]!;
  const colAxis = axes[1] ?? null;
  const cols = colAxis ? colAxis.values : [''];
  const missing = variantsWithoutBarcode(variants);

  const setPrice = (key: string, priceMinor: number | null) =>
    onChange(variants.map((v) => (v.key === key ? { ...v, priceMinor } : v)));

  return (
    <div className="flex flex-col gap-4">
      <div
        className="relative min-w-0 overflow-x-auto rounded-control border border-line"
        role="region"
        aria-label="جدول الأسعار، مرّر جانباً لترى الباقي"
      >
        <table aria-label="أسعار المتغيّرات" className="w-max min-w-full border-separate border-spacing-1.5">
          <thead>
            <tr>
              <th className="sticky start-0 z-10 bg-surface pe-3 ps-2 text-start text-xs font-semibold whitespace-nowrap text-ink-subtle">
                {rowAxis.name}
                {colAxis ? ` / ${colAxis.name}` : ''}
              </th>
              {cols.map((col) => (
                <th
                  key={col || '_'}
                  scope="col"
                  className="px-2 pb-1 text-center text-xs font-semibold whitespace-nowrap text-ink-subtle"
                >
                  {col || 'السعر'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowAxis.values.map((row) => (
              <tr key={row}>
                <th
                  scope="row"
                  className="sticky start-0 z-10 bg-surface pe-3 ps-2 text-start font-semibold whitespace-nowrap text-ink"
                >
                  {row}
                </th>
                {cols.map((col) => {
                  const v = cellOf(variants, rowAxis, row, colAxis, col);
                  if (!v) {
                    return (
                      <td
                        key={col || '_'}
                        className="w-32 min-w-32 rounded-small border border-dashed border-line text-center text-ink-subtle"
                      >
                        —
                      </td>
                    );
                  }
                  return (
                    <td key={col || '_'} className="w-32 min-w-32">
                      <MoneyField
                        label={`سعر ${[row, col].filter(Boolean).join(' · ')}`}
                        hideLabel
                        currency={v.currency}
                        valueMinor={v.priceMinor}
                        onValueChange={(value) => setPrice(v.key, value)}
                      />
                      <LiraCaption
                        minor={v.priceMinor}
                        currency={v.currency}
                        className="block text-center text-xs text-ink-muted"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cols.length > 3 ? (
        <p className="text-xs text-ink-subtle">مرّر الجدول جانباً لترى كل الألوان.</p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2 rounded-control border border-line bg-surface-muted p-3">
        <MoneyField
          label="السعر نفسه لكل المتغيّرات"
          currency={currency}
          valueMinor={same}
          onValueChange={setSame}
          className="w-52"
        />
        <LiraCaption minor={same} currency={currency} />
        <Button
          variant="secondary"
          disabled={same === null}
          onClick={() => onChange(applyToVariants(variants, { all: true }, 'priceMinor', same))}
        >
          طبّق على الكل
        </Button>
      </div>
      <Switch
        label="ولّد باركود لكل متغيّر جديد عند الحفظ"
        description={
          missing === 0
            ? 'لكل متغيّر باركود.'
            : `${String(missing)} بلا باركود: يُولَّد عند الحفظ إن فعّلت هذا الخيار.`
        }
        checked={autoBarcode}
        onCheckedChange={onAutoBarcode}
      />
    </div>
  );
});
