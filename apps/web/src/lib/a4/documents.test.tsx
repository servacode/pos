import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import { DeliveryNoteA4, InvoiceA4, lineBatches, type A4SaleData } from './documents';

const priced = { lineDiscountMinor: 0, taxMinor: 0, totalMinor: 1000 };
const line = (lineNo: number, name: string, extra: Record<string, unknown> = {}) =>
  ({
    lineNo,
    name,
    qty: 12_000,
    packQty: 1000,
    unitPriceMinor: 100,
    taxRateId: null,
    taxRateBp: 0,
    discount: null,
    priced,
    ...extra,
  }) as unknown as SalePayload['lines'][number];

const data = (lines: SalePayload['lines']): A4SaleData => ({
  store: { name: 'مركز الأمل', taxNumber: null, branchName: null, address: null, phone: null, footer: null },
  number: 'INV-1',
  deviceTime: '2026-11-14T10:00:00.000Z',
  timezone: 'Asia/Damascus',
  customer: null,
  cashierName: null,
  payload: {
    currency: 'SYP',
    taxInclusive: true,
    payments: [],
    lines,
    totals: { netExTaxMinor: 0, invoiceDiscountMinor: 0, taxMinor: 0, totalMinor: 0 },
  } as unknown as SalePayload,
});

const split = line(7, 'قفازات', {
  batches: [
    { batchNo: 'B-1', expiry: '2027-01-01', qty: 5000 },
    { batchNo: 'B-2', expiry: '2027-06-01', qty: 7000 },
  ],
  batchNo: 'B-1',
  batchExpiry: '2027-01-01',
});

describe('A4 documents', () => {
  it('lists every batch allocation of a line, the single batch of an older till, and none for no batch', () => {
    expect(lineBatches(split)).toHaveLength(2);
    expect(lineBatches(line(1, 'x', { batchNo: 'Z', batchExpiry: null }))).toEqual([
      { batchNo: 'Z', expiry: null, qty: null },
    ]);
    expect(lineBatches(line(1, 'x'))).toEqual([]);
  });

  it('prints each batch with its expiry and quantity on the invoice, numbering rows 1..n', () => {
    render(<InvoiceA4 data={data([line(3, 'أ'), split, line(12, 'ب')])} />);
    const text = screen.getByLabelText('أصناف الفاتورة').textContent ?? '';
    for (const part of ['B-1', 'B-2', '2027-01-01', '2027-06-01']) expect(text).toContain(part);
    const rows = screen.getByLabelText('أصناف الفاتورة').querySelectorAll('tbody tr');
    expect([...rows].map((r) => r.querySelector('td')?.textContent)).toEqual(['1', '2', '3']);
  });

  it('prints each batch on the delivery note, one under the other, numbering rows 1..n', () => {
    render(<DeliveryNoteA4 data={data([split, line(9, 'ب')])} withPrices={false} />);
    const table = screen.getByLabelText('أصناف التسليم');
    const text = table.textContent ?? '';
    for (const part of ['B-1', 'B-2', '2027-01-01', '2027-06-01']) expect(text).toContain(part);
    const rows = table.querySelectorAll('tbody tr');
    expect([...rows].map((r) => r.querySelector('td')?.textContent)).toEqual(['1', '2']);
  });
});
