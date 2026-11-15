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
          <li>الصنف: كل مقاس ولون قطعة مستقلة، وعددها يُحسب مرة واحدة في كل الشاشات.</li>
          <li>القطع: ما على الرفوف فعلاً، ولا يُحسب الناقص منها.</li>
          <li>ناقص: بِعتَ أكثر مما سجّلت، فاجرد الصنف أو سجّل استلاماً.</li>
          <li>متاح للبيع: ما يبيعه الكاشير اليوم، من غير المنتهي والموقوف والناقص.</li>
        </ul>
      ) : null}
    </div>
  );
}
