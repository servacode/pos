import { normalizeArabic, type SupplierRow } from '@serva/core';

const digitsOf = (text: string) =>
  text
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\D/g, '')
    .replace(/^(00963|963|0)/, '');

/** A supplier already in the list with the same phone, or the same name: the one to offer opening. */
export function findSupplierDuplicate(
  list: SupplierRow[],
  name: string,
  phone: string,
): { supplier: SupplierRow; by: 'phone' | 'name' } | null {
  const p = digitsOf(phone);
  if (p.length >= 6) {
    const byPhone = list.find((s) => s.phone && digitsOf(s.phone) === p);
    if (byPhone) return { supplier: byPhone, by: 'phone' };
  }
  const n = normalizeArabic(name.trim());
  if (n) {
    const byName = list.find((s) => normalizeArabic(s.name.trim()) === n);
    if (byName) return { supplier: byName, by: 'name' };
  }
  return null;
}

/** What is wrong with the payment amount the owner typed, or null. */
export function paymentProblem(text: string, minor: number | null): string | null {
  if (text.trim() === '') return null;
  if (minor === null) {
    const digits = text.replace(/\D/g, '');
    return digits.length > 12
      ? 'المبلغ كبير جداً. تحقّق من الأصفار'
      : 'اكتب المبلغ أرقاماً فقط، بمنزلتين عشريتين على الأكثر';
  }
  return minor <= 0 ? 'المبلغ أكبر من صفر' : null;
}

/** Whether a payment is more than what is owed (so it would be an advance). */
export const isAdvance = (minor: number, owedMinor: number) => minor > Math.max(0, owedMinor);
