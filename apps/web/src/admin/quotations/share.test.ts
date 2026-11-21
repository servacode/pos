import { describe, expect, it } from 'vitest';
import type { Quotation } from '@serva/core';
import { formSignature, lineInput, editorLineOf, savedSignature, type FormParts } from './lines';
import { groupChoices } from './ItemPicker';
import { quotationMessage, quotationWhatsappLink } from './share';

const offer = (over: Partial<Quotation> = {}): Quotation => ({
  id: 'q-1',
  number: 'QUO-2026-000004',
  status: 'sent',
  customerName: 'مشفى الأمل',
  issueDate: '2026-11-01',
  validUntil: '2026-12-31',
  currency: 'SYP',
  totalMinor: 1_900_000,
  version: 2,
  customerId: null,
  customerPhone: '0944111222',
  customerTaxNumber: null,
  customerAddress: null,
  taxInclusive: true,
  notes: 'التوصيل مجاني',
  terms: null,
  lines: [
    {
      lineNo: 1,
      productId: null,
      variantId: null,
      name: 'كمامات',
      unitName: null,
      packName: 'علبة 100',
      packQty: 100_000,
      qty: 2000,
      unitPriceMinor: 1_000_000,
      discount: { type: 'percent', bp: 1000 },
      taxRateId: null,
      taxRateBp: 0,
      priced: {
        grossMinor: 2_000_000,
        lineDiscountMinor: 200_000,
        netMinor: 1_800_000,
        taxMinor: 0,
        netExTaxMinor: 1_800_000,
        totalMinor: 1_800_000,
      },
    },
  ],
  invoiceDiscount: null,
  totals: {
    grossMinor: 2_000_000,
    lineDiscountMinor: 200_000,
    invoiceDiscountMinor: 0,
    discountMinor: 200_000,
    netExTaxMinor: 1_800_000,
    taxMinor: 0,
    totalMinor: 1_800_000,
  },
  convertedAt: null,
  createdByName: null,
  branchName: null,
  createdAt: '2026-11-01T08:00:00.000Z',
  ...over,
});

describe('the WhatsApp message of an offer', () => {
  it('names the store, the number, the customer, each line and the total, then the day and the notes', () => {
    const text = quotationMessage(offer(), 'المركز الطبي');
    expect(text).toContain('عرض سعر من المركز الطبي');
    expect(text).toContain('رقم العرض: QUO-2026-000004');
    expect(text).toContain('السادة: مشفى الأمل');
    expect(text).toContain('1. كمامات: 2 علبة 100 = 18,000 ل.س');
    expect(text).toContain('الخصم: 2,000 ل.س');
    expect(text).toContain('الإجمالي: 18,000 ل.س');
    expect(text).toContain('الأسعار صالحة حتى 31/12/2026');
    expect(text).toContain('ملاحظات: التوصيل مجاني');
    expect(text).not.toContain('الشروط');
    // No bidi marks inside the amounts: they are copied into a chat
    expect(text).not.toMatch(/[⁦-⁩]/);
  });

  it('works without a store name or a customer', () => {
    const text = quotationMessage(offer({ customerName: null, notes: null }), null);
    expect(text.startsWith('عرض سعر\n')).toBe(true);
    expect(text).not.toContain('السادة');
  });

  it('links to the customer’s chat from any common phone form, or to no chat', () => {
    expect(quotationWhatsappLink('0944111222', 'مرحبا')).toBe(
      `https://wa.me/963944111222?text=${encodeURIComponent('مرحبا')}`,
    );
    expect(quotationWhatsappLink('+963 944 111 222', 'x')).toContain('wa.me/963944111222?');
    expect(quotationWhatsappLink(null, 'x')).toBe('https://wa.me/?text=x');
    expect(quotationWhatsappLink('12', 'x')).toBe('https://wa.me/?text=x');
  });
});

describe('what is unsaved in the editor', () => {
  const parts = (q: Quotation): FormParts => ({
    customerId: q.customerId,
    customerName: q.customerName ?? '',
    customerPhone: q.customerPhone ?? '',
    customerTaxNumber: q.customerTaxNumber ?? '',
    customerAddress: q.customerAddress ?? '',
    validUntil: q.validUntil,
    notes: q.notes ?? '',
    terms: q.terms ?? '',
    invoiceDiscount: q.invoiceDiscount,
    lines: q.lines.map((l) => lineInput(editorLineOf(l)) as never),
  });

  it('is the same for a form just filled from the saved offer, spaces and all', () => {
    const q = offer();
    expect(formSignature(parts(q))).toBe(savedSignature(q));
    expect(formSignature({ ...parts(q), notes: ' التوصيل مجاني ' })).toBe(savedSignature(q));
  });

  it('differs once a note, the day, a line or the invoice discount changes, or a number cannot be read', () => {
    const q = offer();
    const same = savedSignature(q);
    expect(formSignature({ ...parts(q), notes: 'غيره' })).not.toBe(same);
    expect(formSignature({ ...parts(q), validUntil: '2027-01-01' })).not.toBe(same);
    expect(formSignature({ ...parts(q), invoiceDiscount: { type: 'amount', minor: 5 } })).not.toBe(same);
    const changed = parts(q);
    changed.lines = [{ ...changed.lines![0]!, qty: 3000 }];
    expect(formSignature(changed)).not.toBe(same);
    expect(formSignature({ ...parts(q), lines: null })).not.toBe(same);
  });
});

describe('the variant chips', () => {
  const choice = (label: string) => ({ line: {} as never, label, priceMinor: 100 });
  it('groups «size · colour» labels by size', () => {
    const groups = groupChoices([choice('30 · أزرق'), choice('30 · أسود'), choice('32 · أزرق')]);
    expect(groups.map((g) => g.head)).toEqual(['30', '32']);
    expect(groups[0]!.items.map((c) => c.label)).toEqual(['أزرق', 'أسود']);
  });
  it('keeps one row when the labels have another shape', () => {
    const groups = groupChoices([choice('صغير'), choice('30 · أزرق')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.head).toBeNull();
    expect(groups[0]!.items.map((c) => c.label)).toEqual(['صغير', '30 · أزرق']);
  });
});
