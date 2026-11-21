import { describe, expect, it } from 'vitest';
import { matchesArabic, PAGE_KEYWORDS, searchWords } from './arabicSearch';

describe('arabicSearch', () => {
  it('drops the article and folds the letter forms', () => {
    expect(searchWords('الأسعار الجديدة')).toEqual(['اسعار', 'جديده']);
  });

  it('finds a page by the stem an owner types', () => {
    expect(matchesArabic('تغيير الأسعار', 'سعر')).toBe(true);
    expect(matchesArabic('تغيير الأسعار', 'اسعار')).toBe(true);
    expect(matchesArabic('قائمة الأسعار', 'قائمه سعر')).toBe(true);
  });

  it('folds hamza, taa marbuta and alef maqsura on both sides', () => {
    expect(matchesArabic('أمين', 'امين')).toBe(true);
    expect(matchesArabic('أبو خالد', 'ابو')).toBe(true);
    expect(matchesArabic('مدرسة', 'مدرسه')).toBe(true);
    expect(matchesArabic('موسى', 'موسي')).toBe(true);
  });

  it('reads Arabic-Indic digits as Latin ones', () => {
    expect(matchesArabic('0944520202', '٠٩٤٤')).toBe(true);
    expect(matchesArabic('INV-000123', 'inv-000١٢٣')).toBe(true);
  });

  it('matches every word typed, in any order, and is empty-friendly', () => {
    expect(matchesArabic('تغيير الأسعار', 'سعر تغيير')).toBe(true);
    expect(matchesArabic('تغيير الأسعار', 'سعر شيك')).toBe(false);
    // A plural carries alefs its stem does not
    expect(matchesArabic('الأقساط', 'قسط')).toBe(true);
    expect(matchesArabic('x', '   ')).toBe(true);
  });

  it('finds a page by a word its name does not carry', () => {
    expect(matchesArabic('الأقساط', 'قسط', PAGE_KEYWORDS['/installments'])).toBe(true);
    expect(matchesArabic('إعدادات المتجر', 'دولار', PAGE_KEYWORDS['/settings'])).toBe(true);
    expect(matchesArabic('الفواتير', 'مرتجع', PAGE_KEYWORDS['/sales/invoices'])).toBe(true);
    expect(matchesArabic('الفروع', 'دولار', PAGE_KEYWORDS['/branches'])).toBe(false);
  });
});
