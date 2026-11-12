import type { SaleListItem } from '@serva/core';
import { csvField, minorToDecimal } from '../accounting/csv';
import { METHOD_TEXT, SALE_STATUS_TEXT } from './labels';

/**
 * The filtered invoice list as CSV for Excel: a byte-order mark so Excel reads the Arabic, CRLF
 * lines, amounts as plain decimals in the invoice's own currency.
 */
export function salesCsv(items: readonly SaleListItem[]): string {
  const header = [
    'رقم الفاتورة',
    'اليوم',
    'الوقت',
    'الفرع',
    'الجهاز',
    'الكاشير',
    'الزبون',
    'طريقة الدفع',
    'العملة',
    'الإجمالي',
    'الخصم',
    'الضريبة',
    'المرتجع',
    'الحالة',
  ].map((title) => csvField(title));
  const rows = items.map((sale) => {
    const n = (minor: number) => csvField(minorToDecimal(minor, sale.currency), true);
    return [
      csvField(sale.number),
      csvField(sale.businessDate, true),
      csvField(sale.deviceTime.slice(11, 16), true),
      csvField(sale.branchName),
      csvField(sale.deviceCode ?? ''),
      csvField(sale.cashier.fullName ?? ''),
      csvField(sale.customer?.name ?? ''),
      csvField(sale.methods.map((m) => METHOD_TEXT[m]).join(' + ')),
      csvField(sale.currency),
      n(sale.totalMinor),
      n(sale.discountMinor),
      n(sale.taxMinor),
      n(sale.returnedMinor),
      csvField(SALE_STATUS_TEXT[sale.status]),
    ];
  });
  return `\uFEFF${[header, ...rows].map((cells) => cells.join(',')).join('\r\n')}\r\n`;
}
