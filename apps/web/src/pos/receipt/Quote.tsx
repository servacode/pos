import { createPortal } from 'react-dom';
import type { SettingsRow } from '@serva/core/contracts/catalog';
import type { SaleLine } from '@serva/core/contracts/documents';
import type { PricedInvoice } from '@serva/core/pricing';
import { cn, formatQuantity, Money, useDigits } from '@serva/ui';
import { clockText, dateText } from '../format';
import { discountLabel } from '../print/lines';
import type { PaperWidth } from './Receipt';

export interface QuoteData {
  settings: SettingsRow;
  lines: SaleLine[];
  totals: PricedInvoice['totals'];
  at: number;
  cashierName: string;
  wholesale: boolean;
  customerName?: string | null;
  /** QUO number and last day, once the server saved it; `unsaved` when it could not be */
  number?: string | null;
  validUntil?: string | null;
  unsaved?: boolean;
}

/**
 * «عرض سعر» (03 › الجملة: عرض السعر): the cart printed for a customer to take away, with no sale,
 * no number and nothing in the books. The prices are the till's at that moment.
 */
export function Quote({ data, width = 80 }: { data: QuoteData; width?: PaperWidth }) {
  const digits = useDigits();
  const base = data.settings.baseCurrency;
  return (
    <div
      dir="rtl"
      lang="ar"
      aria-label="عرض سعر"
      className={cn(
        'flex flex-col gap-2 bg-surface px-1 py-3 font-semibold text-ink',
        width === 80 ? 'w-[72mm] text-[13px]/[1.55]' : 'w-[48mm] text-[11px]/[1.5]',
      )}
    >
      <div className="flex flex-col items-center">
        <span className="text-base font-bold">{data.settings.storeName}</span>
        <span className="text-lg font-bold">عرض سعر</span>
        {data.number ? (
          <bdi dir="ltr" className="num font-bold">
            {data.number}
          </bdi>
        ) : null}
        {data.wholesale ? <span>بأسعار الجملة</span> : null}
        <span>
          {dateText(data.at, digits)} ، {clockText(data.at, digits)}
        </span>
        <span>{data.cashierName}</span>
      </div>
      <hr className="border-dashed border-ink" />
      <ul className="flex flex-col gap-1.5">
        {data.lines.map((line) => (
          <li key={line.lineNo} className="flex flex-col">
            <span className="font-bold">{line.name}</span>
            <div className="flex justify-between gap-2">
              <bdi dir="rtl" className="num">
                {formatQuantity(line.qty, digits)}
                {line.unitName ? ` ${line.unitName}` : ''} ×{' '}
                <Money minor={line.unitPriceMinor} currency={base} symbol={false} />
              </bdi>
              <Money minor={line.priced.grossMinor} currency={base} symbol={false} />
            </div>
            {line.priced.lineDiscountMinor > 0 ? (
              <div className="flex justify-between gap-2">
                <span>{discountLabel(line.discount)}</span>
                <span>
                  −<Money minor={line.priced.lineDiscountMinor} currency={base} symbol={false} />
                </span>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <hr className="border-dashed border-ink" />
      <div className="flex justify-between text-base font-bold">
        <span>المجموع</span>
        <Money minor={data.totals.totalMinor} currency={base} />
      </div>
      {data.validUntil ? (
        <p className="text-center">
          صالح حتى <bdi className="num">{dateText(Date.parse(`${data.validUntil}T12:00:00`), digits)}</bdi>
        </p>
      ) : null}
      {data.unsaved ? <p className="text-center text-xs">لم يُحفظ في النظام: لا اتصال بالخادم.</p> : null}
      <p className="text-center text-xs">هذا عرض سعر وليس فاتورة. الأسعار قابلة للتغيّر.</p>
    </div>
  );
}

/** What `window.print()` prints for a quote, as PrintableReceipt does for a receipt. */
export function PrintableQuote({ data, width }: { data: QuoteData; width: PaperWidth }) {
  return createPortal(
    <div data-print-receipt="" className="hidden print:block">
      <style>{`@page { size: ${width}mm auto; margin: 0 }`}</style>
      <Quote data={data} width={width} />
    </div>,
    document.body,
  );
}
