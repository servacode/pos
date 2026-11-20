import type { SaleListItem } from '@serva/core';
import { csvField, minorToDecimal } from '../accounting/csv';
import { METHOD_TEXT, SALE_STATUS_TEXT } from './labels';

/** «21:30» of a moment in the store's time zone, 24 hours with Latin digits, as the list shows its time. */
export function storeClock(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: 'hour' | 'minute') => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

/**
 * The filtered invoice list as CSV for Excel: a byte-order mark so Excel reads the Arabic, CRLF
 * lines, amounts as plain decimals in the invoice's own currency, the time in the store's time zone.
 */
export function salesCsv(items: readonly SaleListItem[], timeZone = 'Asia/Damascus'): string {
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
    'الحسم',
    'الضريبة',
    'المرتجع',
    'الحالة',
  ].map((title) => csvField(title));
  const rows = items.map((sale) => {
    const n = (minor: number) => csvField(minorToDecimal(minor, sale.currency), true);
    return [
      csvField(sale.number),
      csvField(sale.businessDate, true),
      csvField(storeClock(sale.deviceTime, timeZone), true),
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
