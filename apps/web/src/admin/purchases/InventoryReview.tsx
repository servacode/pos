import type { Dispatch, SetStateAction } from 'react';
import type { InventoryResponse } from '@serva/core';
import { formatQuantity, StockIcon, type Digits } from '@serva/ui';
import { Amt, Panel, StatusPill, SxTable, type SxColumn } from '../sales/ui';
import { SerialEntry, SerialPick } from './SerialPick';
import { differenceWord, type reviewCount } from './stocktakeReview';

type Line = ReturnType<typeof reviewCount>[number];

/** «راجع الجرد قبل التسجيل»: counted against expected, the value of the difference, and the serial numbers to name. */
export function InventoryReview({
  review,
  reviewShort,
  reviewOver,
  reviewTotal,
  needSerials,
  needNew,
  base,
  digits,
  countBranch,
  countSerials,
  setCountSerials,
}: {
  review: Line[];
  reviewShort: number;
  reviewOver: number;
  reviewTotal: number;
  needSerials: Line[];
  needNew: Line[];
  base: InventoryResponse['baseCurrency'];
  digits: Digits;
  countBranch: string;
  countSerials: Record<string, string[]>;
  setCountSerials: Dispatch<SetStateAction<Record<string, string[]>>>;
}) {
  const reviewColumns: SxColumn<Line>[] = [
    { key: 'name', header: 'الصنف', lead: true, cell: (l) => l.name },
    {
      key: 'counted',
      header: 'المعدود',
      numeric: true,
      cell: (l) => <bdi className="sx-n">{formatQuantity(l.countedQty, digits)}</bdi>,
    },
    {
      key: 'expected',
      header: 'المتوقع',
      numeric: true,
      cell: (l) => <bdi className="sx-n">{formatQuantity(l.expectedQty, digits)}</bdi>,
    },
    {
      key: 'diff',
      header: 'الفرق',
      numeric: true,
      cell: (l) => (
        <span className="inline-flex items-center gap-2">
          <StatusPill kind={l.diffQty < 0 ? 'danger' : l.diffQty > 0 ? 'warn' : 'ok'}>
            {differenceWord(l.diffQty)}
          </StatusPill>
          <bdi dir="ltr" className="sx-n">
            {formatQuantity(Math.abs(l.diffQty), digits)}
          </bdi>
        </span>
      ),
    },
    {
      key: 'value',
      header: 'قيمة الفرق',
      numeric: true,
      strong: true,
      cell: (l) => <Amt minor={Math.abs(l.diffValueMinor)} currency={base} />,
    },
  ];
  return (
    <Panel title="راجع الجرد قبل التسجيل" flush>
      <p className="sx-wait" style={{ padding: '0 16px 12px' }}>
        ما عددته مقابل ما يتوقعه النظام. الزيادة تدخل المخزون والنقص يخرج منه بكلفته.
      </p>
      <p className="sx-note tight" style={{ margin: '0 16px 12px', paddingTop: 0, borderTop: 0 }}>
        {reviewTotal === 0 && reviewShort === 0 ? (
          'لا فرق في القيمة.'
        ) : (
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <span>
              نقص <Amt minor={reviewShort} currency={base} className="font-bold" />
            </span>
            <span aria-hidden="true">·</span>
            <span>
              زيادة <Amt minor={reviewOver} currency={base} className="font-bold" />
            </span>
            <span aria-hidden="true">·</span>
            <span>
              الصافي <Amt minor={Math.abs(reviewTotal)} currency={base} className="font-bold" />
              {reviewTotal < 0 ? ' نقصاً' : reviewTotal > 0 ? ' زيادة' : ''}
            </span>
          </span>
        )}
      </p>
      <SxTable
        bare
        caption="فروق الجرد"
        columns={reviewColumns}
        rows={review}
        rowKey={(l) => l.variantId}
        empty={
          <div className="ix-empty">
            <StockIcon size={32} />
            <h3>لم تعدّ أي صنف.</h3>
          </div>
        }
      />
      {needSerials.length > 0 || needNew.length > 0 ? (
        <div className="flex flex-col gap-3" style={{ padding: 16 }}>
          <p className="sx-wait">
            هذه الأصناف لها أرقام تسلسلية: اختر الأرقام التي خرجت من الرف، فتتفق قائمة الأرقام مع الجرد.
          </p>
          {needSerials.map((l) => (
            <SerialPick
              key={l.variantId}
              name={l.name}
              variantId={l.variantId}
              branchId={countBranch}
              pieces={Math.ceil(-l.diffQty / 1000)}
              picked={countSerials[l.variantId] ?? []}
              onChange={(list) => setCountSerials((c) => ({ ...c, [l.variantId]: list }))}
            />
          ))}
          {needNew.length > 0 ? (
            <p className="sx-wait">
              وجدت قطعاً أكثر من الدفتر لصنف له أرقام تسلسلية: اكتب رقم كل قطعة زائدة (أو امسحه). رقم سجّلته
              ضائعاً سابقاً ثم وجدته يعود إلى المخزون من هنا.
            </p>
          ) : null}
          {needNew.map((l) => (
            <SerialEntry
              key={l.variantId}
              name={l.name}
              pieces={Math.ceil(l.diffQty / 1000)}
              picked={countSerials[l.variantId] ?? []}
              onChange={(list) => setCountSerials((c) => ({ ...c, [l.variantId]: list }))}
            />
          ))}
        </div>
      ) : null}
    </Panel>
  );
}
