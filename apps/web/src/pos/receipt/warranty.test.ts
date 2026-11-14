import { describe, expect, it } from 'vitest';
import type { SettingsRow } from '@serva/core/contracts/catalog';
import { certificateOf, serialText, warrantyText } from './warranty';

const settings = {
  timezone: 'Asia/Damascus',
  businessDayCutoff: '00:00',
  sectors: ['electronics'],
} as SettingsRow;
const line = { serials: ['IMEI351'], warrantyMonths: 12, name: 'هاتف A15 · كفالة 12 شهراً' };

describe('the warranty on a receipt', () => {
  it('names the number «IMEI» for phones and «الرقم التسلسلي» elsewhere', () => {
    expect(serialText(line, settings)).toBe('IMEI IMEI351');
    expect(serialText(line, { sectors: ['medical_supplies'] })).toBe('الرقم التسلسلي IMEI351');
    expect(serialText({ serials: [] }, settings)).toBeNull();
  });

  it('prints the end date as dd/mm/yyyy from the sale day', () => {
    expect(warrantyText(line, '2026-10-30T09:00:00.000Z', settings)).toBe('الكفالة حتى 30/10/2027');
    // After midnight in the store's zone it is the next day
    expect(warrantyText(line, '2026-10-30T22:30:00.000Z', settings)).toBe('الكفالة حتى 31/10/2027');
    expect(warrantyText({ serials: ['A1B2C3'] }, '2026-10-30T09:00:00.000Z', settings)).toBeNull();
    expect(warrantyText({ warrantyMonths: 12 }, '2026-10-30T09:00:00.000Z', settings)).toBeNull();
  });

  it('builds the certificate: one row per serial, the store terms, none without a warranty', () => {
    const data = {
      doc: {
        number: 'INV-001-001-0000007',
        deviceTime: '2026-10-30T09:00:00.000Z',
        payload: {
          customerName: 'سامر',
          lines: [
            { ...line, serials: ['A-1', 'A-2'] },
            { name: 'شاحن', serials: undefined },
          ],
        },
      },
      settings: { ...settings, till: { warrantyTerms: 'شروطنا' } } as SettingsRow,
      storeName: 'متجر',
      branchName: 'الفرع',
      branch: { phone: '011' },
    };
    const cert = certificateOf(data, '0944');
    expect(cert).toMatchObject({
      customerName: 'سامر',
      customerPhone: '0944',
      terms: 'شروطنا',
      saleNumber: 'INV-001-001-0000007',
    });
    expect(cert!.items.map((i) => [i.serial, i.until])).toEqual([
      ['A-1', '2027-10-30'],
      ['A-2', '2027-10-30'],
    ]);
    const none = { ...data, doc: { ...data.doc, payload: { lines: [{ name: 'x' }] } } };
    expect(certificateOf(none, null)).toBeNull();
  });
});
