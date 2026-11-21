import type { CurrencyCode, CustomerListItem } from '@serva/core';
import { csvField, minorToDecimal } from '../accounting/csv';

/** The customers list as a CSV for Excel: name, phone, what they owe, their limit, last purchase, spend. */
export function customersCsv(items: readonly CustomerListItem[], currency: CurrencyCode): string {
  const header = ['الزبون', 'الجوال', 'الرصيد', 'حد الدين', 'آخر شراء', 'مجموع المشتريات', 'الحالة'].map(
    (t) => csvField(t),
  );
  const money = (minor: number) => csvField(minorToDecimal(minor, currency), true);
  const rows = items.map((c) => [
    csvField(c.name),
    csvField(c.phone ?? '', true),
    money(c.balanceMinor),
    c.creditLimitMinor === null ? csvField('') : money(c.creditLimitMinor),
    csvField(c.lastPurchaseDate ?? '', true),
    c.spentMinor ? money(c.spentMinor) : csvField(''),
    csvField(c.archived ? 'مؤرشف' : ''),
  ]);
  return `\uFEFF${[header, ...rows].map((cells) => cells.join(',')).join('\r\n')}\r\n`;
}
