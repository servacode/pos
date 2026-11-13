import { describe, expect, it } from 'vitest';
import type { SupplierRow } from '@serva/core';
import { findSupplierDuplicate, isAdvance, paymentProblem } from './supplierRules';

const sup = (id: string, name: string, phone: string | null): SupplierRow => ({
  id,
  name,
  phone,
  notes: null,
  balanceMinor: 0,
  archived: false,
});
const list = [sup('1', 'شركة النور', '0933123456'), sup('2', 'مؤسسة الفرات', null)];

describe('findSupplierDuplicate', () => {
  it('finds the same phone in any writing, then the same name', () => {
    expect(findSupplierDuplicate(list, 'أي اسم', '+963 933 123 456')).toMatchObject({ by: 'phone' });
    expect(findSupplierDuplicate(list, 'أي اسم', '٠٩٣٣١٢٣٤٥٦')?.supplier.id).toBe('1');
    expect(findSupplierDuplicate(list, ' مؤسسة الفرات ', '')).toMatchObject({ by: 'name' });
    expect(findSupplierDuplicate(list, 'جديد', '0944000000')).toBeNull();
    expect(findSupplierDuplicate(list, '', '')).toBeNull();
  });
});

describe('paymentProblem and isAdvance', () => {
  it('explains a bad amount and spots an advance', () => {
    expect(paymentProblem('', null)).toBeNull();
    expect(paymentProblem('88299999999999999', null)).toContain('كبير جداً');
    expect(paymentProblem('12.345', null)).toContain('منزلتين');
    expect(paymentProblem('0', 0)).toContain('أكبر من صفر');
    expect(paymentProblem('5', 500)).toBeNull();
    expect(isAdvance(500, 300)).toBe(true);
    expect(isAdvance(300, 300)).toBe(false);
    expect(isAdvance(1, -50)).toBe(true);
  });
});
