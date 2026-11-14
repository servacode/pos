import { describe, expect, it } from 'vitest';
import { buildSalePayload } from '@serva/core/sale';
import { DOTS, FEED_AND_CUT, INIT, OPEN_DRAWER, printJob, rasterImage, toBits } from './escpos';
import { receiptLines } from './lines';

describe('ESC/POS for a thermal printer', () => {
  it('packs pixels into 1-bit rows: dark is a dot, light and transparent are paper', () => {
    // 10 pixels wide: black, white, transparent, then 7 black
    const rgba = new Uint8ClampedArray(10 * 4);
    const set = (x: number, v: number, a = 255) => rgba.set([v, v, v, a], x * 4);
    set(0, 0);
    set(1, 255);
    set(2, 0, 0);
    for (let x = 3; x < 10; x++) set(x, 20);
    expect([...toBits(rgba, 10, 1)]).toEqual([0b10011111, 0b11000000]);
  });

  it('sends the image as GS v 0 bands with their width and height, little end first', () => {
    const width = 16;
    const bits = new Uint8Array(2 * 300).fill(0xaa);
    const parts = rasterImage(bits, width, 300, 256);
    expect(parts).toHaveLength(2);
    expect([...parts[0]!.subarray(0, 8)]).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 0, 1]);
    expect([...parts[1]!.subarray(0, 8)]).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 44, 0]);
    expect(parts[0]!.length).toBe(8 + 2 * 256);
    expect(parts[1]!.length).toBe(8 + 2 * 44);
  });

  it('wraps the job in init, feed and cut, and opens the drawer only when asked', () => {
    const bits = new Uint8Array(1);
    expect(printJob(bits, 8, 1, false)).toEqual([INIT, rasterImage(bits, 8, 1)[0], FEED_AND_CUT]);
    expect(printJob(bits, 8, 1, true).at(-1)).toEqual(OPEN_DRAWER);
    expect(DOTS).toEqual({ 80: 576, 58: 384 });
  });
});

describe('the receipt as printer lines', () => {
  const sale = buildSalePayload({
    currency: 'SYP',
    taxInclusive: true,
    exchangeRates: [],
    shiftId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a03',
    cashierId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a04',
    cashSteps: {},
    lines: [
      {
        lineNo: 1,
        productId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01',
        variantId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a02',
        name: 'زيت دوار الشمس',
        qty: 2000,
        priceCurrency: 'SYP',
        priceMinor: 25_000,
        taxRateBp: 0,
      },
    ],
    payments: [{ method: 'cash', currency: 'SYP', amountMinor: 60_000 }],
  });
  const data = {
    doc: { number: 'INV-001-002-0000007', deviceTime: '2026-10-30T09:00:00.000Z', payload: sale as never },
    settings: { storeName: 'سوبرماركت الفرات', taxNumber: '123', receiptFooter: 'أهلاً بكم' } as never,
    branch: { phone: '0944 123 456', address: 'الرقة' } as never,
    storeName: 'سوبرماركت الفرات',
    branchName: 'فرع النعيم',
    deviceName: 'الصندوق 2',
    cashierName: 'سامر',
  };

  it('has the store, the number, each line, the total, the payment and the change', () => {
    const lines = receiptLines(data);
    const text = JSON.stringify(lines);
    expect(lines[0]).toEqual({ kind: 'center', text: 'سوبرماركت الفرات', bold: true, big: true });
    expect(text).toContain('INV-001-002-0000007');
    expect(text).toContain('زيت دوار الشمس');
    expect(lines).toContainEqual({ kind: 'pair', start: 'الإجمالي', end: '500 ل.س', bold: true });
    expect(lines).toContainEqual({ kind: 'pair', start: 'الباقي للزبون', end: '100 ل.س', bold: true });
    expect(text).toContain('أهلاً بكم');
    expect(text).not.toMatch(/[⁦-⁩]/);
  });

  it('marks a reprint as a copy', () => {
    expect(receiptLines(data, true)[0]).toEqual({ kind: 'center', text: '— نسخة —', bold: true });
  });

  it('prints an exchange voucher under the return: its amount, its bars and its number', () => {
    const ret = {
      saleNumber: 'INV-001-002-0000007',
      currency: 'SYP',
      reason: 'المقاس صغير',
      lines: [{ name: 'قميص M', qty: 1000, refund: { totalMinor: 45_000 } }],
      totals: { totalMinor: 45_000, taxMinor: 0 },
      refunds: [{ method: 'voucher', currency: 'SYP', amountMinor: 45_000, reference: null }],
    };
    const lines = receiptLines({
      ...data,
      kind: 'return',
      doc: { ...data.doc, number: 'SRT-001-002-0000003', payload: ret as never },
    } as never);
    expect(lines).toContainEqual({ kind: 'center', text: 'قسيمة استبدال', bold: true, big: true });
    expect(lines).toContainEqual({ kind: 'barcode', code: 'SRT-001-002-0000003' });
    expect(lines).toContainEqual({ kind: 'center', text: '450 ل.س', bold: true, big: true });
    // A cash return has none
    const cash = receiptLines({
      ...data,
      kind: 'return',
      doc: {
        ...data.doc,
        number: 'SRT-001-002-0000004',
        payload: { ...ret, refunds: [{ ...ret.refunds[0], method: 'cash' }] } as never,
      },
    } as never);
    expect(cash.some((l) => l.kind === 'barcode')).toBe(false);
  });

  describe('a pharmacy receipt as printer lines', () => {
    const withRx = (prescription: unknown, batch = true) => ({
      ...data,
      doc: {
        ...data.doc,
        payload: {
          ...sale,
          prescription,
          lines: sale.lines.map((l) => ({
            ...l,
            ...(batch ? { batchNo: 'B-07', batchExpiry: '2027-01-01' } : {}),
          })),
        } as never,
      },
    });

    it('prints the batch of a line, and the prescription number, doctor and patient (not the ID)', () => {
      const lines = receiptLines(
        withRx({ ref: 'RX-77', doctor: 'د. سامر', patientName: 'ليلى', patientId: '01020304' }),
      );
      const text = JSON.stringify(lines);
      expect(text).toContain('دفعة B-07 · تنتهي 1 كانون الثاني 2027');
      expect(lines).toContainEqual({ kind: 'pair', start: 'رقم الوصفة', end: 'RX-77' });
      expect(lines).toContainEqual({ kind: 'pair', start: 'الطبيب', end: 'د. سامر' });
      expect(lines).toContainEqual({ kind: 'pair', start: 'المريض', end: 'ليلى' });
      expect(text).not.toContain('01020304');
    });

    it('prints each batch a line was split over, with what it took from it', () => {
      const split = withRx(null, false);
      (split.doc.payload as { lines: { batches?: object[] }[] }).lines[0]!.batches = [
        { batchNo: 'G-OLD', expiry: '2027-01-01', qty: 2000 },
        { batchNo: null, expiry: null, qty: 1000 },
      ];
      const text = JSON.stringify(receiptLines(split));
      expect(text).toContain('دفعة G-OLD · تنتهي 1 كانون الثاني 2027 ×');
      expect(text).toContain('دفعة — ×');
    });

    it('prints a batch without a date, and nothing when the prescription is empty', () => {
      const noDate = withRx(null);
      (noDate.doc.payload as { lines: { batchExpiry?: string | null }[] }).lines[0]!.batchExpiry = null;
      const lines = receiptLines(noDate);
      expect(JSON.stringify(lines)).toContain('دفعة B-07');
      expect(JSON.stringify(lines)).not.toContain('تنتهي');
      expect(JSON.stringify(lines)).not.toContain('رقم الوصفة');
      const empty = receiptLines(
        withRx({ ref: null, doctor: null, patientName: null, patientId: null }, false),
      );
      expect(JSON.stringify(empty)).not.toContain('رقم الوصفة');
      expect(JSON.stringify(empty)).not.toContain('دفعة');
    });

    it('prints the doctor alone, without a number or a patient', () => {
      const lines = receiptLines(
        withRx({ ref: null, doctor: 'د. هالة', patientName: null, patientId: null }),
      );
      expect(lines).toContainEqual({ kind: 'pair', start: 'الطبيب', end: 'د. هالة' });
      expect(JSON.stringify(lines)).not.toContain('رقم الوصفة');
      expect(JSON.stringify(lines)).not.toContain('المريض');
    });
  });
});
