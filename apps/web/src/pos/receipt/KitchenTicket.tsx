import { createPortal } from 'react-dom';
import type { OrderType } from '@serva/core/contracts/documents';
import { formatQuantity, useDigits } from '@serva/ui';
import { clockText } from '../format';

export const ORDER_TYPE_TEXT: Record<OrderType, string> = {
  dine_in: 'صالة',
  takeaway: 'سفري',
  delivery: 'توصيل',
};

export interface KitchenData {
  lines: { lineNo: number; name: string; qty: number; unit: string | null }[];
  orderType: OrderType;
  table: string | null;
  at: number;
  cashierName: string;
}

/**
 * «ورقة المطبخ» (03 › المطاعم: المطبخ): what is new on the order, big, without prices: the
 * quantity, the item with its choices and note, the table or «سفري».
 */
export function KitchenTicket({ data }: { data: KitchenData }) {
  const digits = useDigits();
  return (
    <div
      dir="rtl"
      lang="ar"
      aria-label="ورقة المطبخ"
      className="flex w-[72mm] flex-col gap-2 bg-surface px-1 py-3 text-ink"
    >
      <div className="flex items-baseline justify-between text-xl font-bold">
        <span>{data.table ? `طاولة ${data.table}` : ORDER_TYPE_TEXT[data.orderType]}</span>
        <span className="num text-base">{clockText(data.at, digits)}</span>
      </div>
      <span className="text-sm">{data.cashierName}</span>
      <hr className="border-dashed border-ink" />
      <ul className="flex flex-col gap-2 text-lg font-bold">
        {data.lines.map((l) => (
          <li key={l.lineNo} className="flex gap-3">
            <bdi className="num min-w-10">
              {formatQuantity(l.qty, digits)}
              {l.unit ? ` ${l.unit}` : ''}
            </bdi>
            <span>{l.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PrintableKitchenTicket({ data }: { data: KitchenData }) {
  return createPortal(
    <div data-print-receipt="" className="hidden print:block">
      <style>{`@page { size: 80mm auto; margin: 0 }`}</style>
      <KitchenTicket data={data} />
    </div>,
    document.body,
  );
}
