import { createPortal } from 'react-dom';
import { formatMoney, type CurrencyCode } from '@serva/core';
import { Bars } from '../../lib/Bars';

/** One label to print: a piece of a product with its options, price and code. */
export interface LabelItem {
  key: string;
  name: string;
  /** «M · أحمر»; null for a simple product */
  options: string | null;
  priceMinor: number;
  /** The price before a markdown, printed struck through beside the new one; null: none */
  wasMinor?: number | null;
  currency: CurrencyCode;
  code: string;
  copies: number;
}

/**
 * Label sizes (03 › الملابس: ملصق لكل قطعة): rolls for a thermal label printer, one label per
 * page, or A4 sheets of stickers in a grid.
 */
export const LABEL_LAYOUTS = {
  '40x30': { label: 'لفة 40×30 مم', kind: 'roll', width: 40, height: 30 },
  '50x30': { label: 'لفة 50×30 مم', kind: 'roll', width: 50, height: 30 },
  '50x25': { label: 'لفة 50×25 مم', kind: 'roll', width: 50, height: 25 },
  '58x40': { label: 'لفة 58×40 مم', kind: 'roll', width: 58, height: 40 },
  a4_3x8: { label: 'ورق A4، 24 ملصقاً (70×37)', kind: 'sheet', width: 70, height: 37, columns: 3, rows: 8 },
  a4_4x10: {
    label: 'ورق A4، 40 ملصقاً (52×30)',
    kind: 'sheet',
    width: 52.5,
    height: 29.7,
    columns: 4,
    rows: 10,
  },
} as const;
export type LabelLayout = keyof typeof LABEL_LAYOUTS;

/** One label: the store, the product and its options, the price big, the bars and their digits. */
export function Label({ item, store, showStore }: { item: LabelItem; store: string; showStore: boolean }) {
  return (
    <div
      dir="rtl"
      className="flex h-full w-full flex-col items-center justify-between overflow-hidden bg-surface px-[1.5mm] py-[1mm] text-center text-ink"
      style={{ fontSize: '2.6mm', lineHeight: 1.15 }}
    >
      {showStore ? <span className="w-full truncate font-semibold">{store}</span> : null}
      <span className="w-full truncate font-bold">{item.name}</span>
      {item.options ? <span className="w-full truncate">{item.options}</span> : null}
      <span className="flex items-baseline justify-center gap-[1.5mm]">
        {item.wasMinor && item.wasMinor > item.priceMinor ? (
          <s aria-label="السعر قبل التنزيل" style={{ fontSize: '2.8mm' }}>
            {formatMoney(item.wasMinor, item.currency)}
          </s>
        ) : null}
        <span className="font-bold" style={{ fontSize: '3.6mm' }}>
          {formatMoney(item.priceMinor, item.currency)}
        </span>
      </span>
      <div className="w-full flex-1" style={{ minHeight: '5mm', maxHeight: '11mm' }}>
        <Bars code={item.code} height={40} />
      </div>
      <bdi dir="ltr" style={{ fontSize: '2.4mm', letterSpacing: '0.3mm' }}>
        {item.code}
      </bdi>
    </div>
  );
}

/** Every copy of every item, in order. */
export function expand(items: readonly LabelItem[]): LabelItem[] {
  return items.flatMap((item) => Array.from({ length: Math.max(0, Math.min(item.copies, 500)) }, () => item));
}

/** What `window.print()` prints: the labels at their size, alone on the page. */
export function PrintableLabels({
  items,
  layout,
  store,
  showStore,
}: {
  items: readonly LabelItem[];
  layout: LabelLayout;
  store: string;
  showStore: boolean;
}) {
  const spec = LABEL_LAYOUTS[layout];
  const all = expand(items);
  const page =
    spec.kind === 'roll'
      ? `@page { size: ${spec.width}mm ${spec.height}mm; margin: 0 }`
      : '@page { size: A4; margin: 0 }';
  return createPortal(
    <div data-print-receipt="" className="hidden print:block">
      <style>{page}</style>
      {spec.kind === 'roll' ? (
        all.map((item, i) => (
          <div
            key={`${item.key}-${i}`}
            style={{ width: `${spec.width}mm`, height: `${spec.height}mm`, breakAfter: 'page' }}
          >
            <Label item={item} store={store} showStore={showStore} />
          </div>
        ))
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${spec.columns}, ${spec.width}mm)`,
            gridAutoRows: `${spec.height}mm`,
            width: '210mm',
          }}
        >
          {all.map((item, i) => (
            <div
              key={`${item.key}-${i}`}
              style={{
                breakInside: 'avoid',
                ...(i > 0 && i % (spec.columns * spec.rows) === 0 ? { breakBefore: 'page' } : {}),
              }}
            >
              <Label item={item} store={store} showStore={showStore} />
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
