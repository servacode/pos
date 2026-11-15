import { useState } from 'react';
import { countNoun, COUNT_NOUNS } from '@serva/core';
import { IconButton, InfoIcon } from '@serva/ui';

/**
 * The shortage in the unit it is counted in: kinds (combinations of size and colour) are «أصناف ناقصة»,
 * pieces are «ناقص 9 قطع», so the same word never means two different things on two screens.
 */
export function shortKinds(count: number): string {
  if (count === 1) return 'صنف واحد ناقص';
  if (count === 2) return 'صنفان ناقصان';
  return count >= 3 && count <= 10
    ? `${countNoun(count, COUNT_NOUNS.item)} ناقصة`
    : `${countNoun(count, COUNT_NOUNS.item)} ناقصاً`;
}

/** Sizes and colours are the clothing store's «أصناف»: the plain words for the same count */
const SIZE_COLOUR = {
  one: 'مقاس/لون واحد',
  two: 'مقاسان/لونان',
  few: 'مقاسات/ألوان',
  many: 'مقاساً/لوناً',
} as const;

/**
 * One plain sentence for «نفد من الرف»: «12 مقاساً/لوناً نفد من 4 منتجات» in a clothing store, «3 أصناف نفدت»
 * elsewhere. `products` is how many products those combinations belong to (absent from an older server).
 */
export function soldOutSentence(variants: number, products: number | undefined, clothing: boolean): string {
  if (variants <= 0) return '';
  const verb = variants === 1 ? 'نفد' : variants === 2 ? 'نفدا' : variants <= 10 ? 'نفدت' : 'نفد';
  if (clothing) {
    const of =
      products !== undefined && products > 0
        ? ` من ${countNoun(products, COUNT_NOUNS.product, String(products), true)}`
        : '';
    return `${countNoun(variants, SIZE_COLOUR)} ${verb}${of}`;
  }
  return `${countNoun(variants, COUNT_NOUNS.item)} ${verb}`;
}

/** The card's «أقلّها: جوارب قطن — نفد»: a count of zero is said as a word, not as a bare «0» */
export function lowestSentence(name: string, qtyText: string, qty: number): string {
  return `أقلّها: ${name} — ${qty === 0 ? 'نفد' : `بقي ${qtyText}`}`;
}

/** «ناقص 9 قطع»: how far below zero, in pieces (`text` is the quantity already formatted) */
export const shortPieces = (count: number, text: string): string =>
  `ناقص ${countNoun(count, COUNT_NOUNS.piece, text)}`;

/** The one definition of the stock numbers, behind an «i» next to the tiles on the products and inventory pages */
export function StockDefinitions() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-sm text-ink-muted">
        <IconButton
          size="xs"
          label={open ? 'أخفِ معنى الأرقام' : 'ما معنى هذه الأرقام؟'}
          icon={<InfoIcon size={16} />}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        />
        <span aria-hidden="true">ما معنى هذه الأرقام؟</span>
      </span>
      {open ? (
        <ul className="flex list-disc flex-col gap-1 ps-5 text-sm text-ink-muted">
          <li>
            الصنف (أو المقاس/اللون في الألبسة): كل مقاس ولون قطعة مستقلة، وعددها يُحسب مرة واحدة في كل
            الشاشات.
          </li>
          <li>القطع: ما على الرفوف فعلاً، ولا يُحسب الناقص منها.</li>
          <li>ناقص: بِعتَ أكثر مما سجّلت، فاجرد الصنف أو سجّل استلاماً.</li>
          <li>متاح للبيع: ما يبيعه الكاشير اليوم، من غير المنتهي والموقوف والناقص.</li>
        </ul>
      ) : null}
    </div>
  );
}
