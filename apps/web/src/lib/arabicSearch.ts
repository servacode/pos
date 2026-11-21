import { normalizeArabic } from '@serva/core/text';

/**
 * Search the way an owner types (round 44): both sides in the one search form of @serva/core
 * (hamza seats, ة/ه, ى/ي, diacritics, Arabic-Indic digits) and without the article, so «سعر» finds
 * «الأسعار», «ابو» finds «أبو» and «امين» finds «أمين». Words are matched one by one, in any order.
 */

/** A word without its leading «ال» (after normalising; only when something is left of it) */
function bare(word: string): string {
  return word.length > 3 && word.startsWith('ال') ? word.slice(2) : word;
}

/** The words of a text in search form, articles stripped: «الأسعار الجديدة» → [«اسعار», «جديده»] */
export function searchWords(text: string): string[] {
  return normalizeArabic(text).split(' ').filter(Boolean).map(bare);
}

const withoutAlef = (text: string): string => text.replaceAll('ا', '');

/** True when every word typed is the start or the inside of a word of `text` (or of one of `extra`) */
export function matchesArabic(text: string, query: string, ...extra: (string | undefined)[]): boolean {
  const wanted = searchWords(query);
  if (wanted.length === 0) return true;
  const joined = searchWords([text, ...extra].filter(Boolean).join(' ')).join(' ');
  // The plural of an Arabic noun carries alefs its stem does not («أسعار» / «سعر», «أقساط» / «قسط»):
  // a word that is not found as typed is looked for again with the alefs left out on both sides
  const skeleton = withoutAlef(joined);
  return wanted.every((word) => {
    if (joined.includes(word)) return true;
    const stem = withoutAlef(word);
    return stem.length > 1 && skeleton.includes(stem);
  });
}

/**
 * Words an owner types for a page that its name does not carry («دولار» for the currency and rate
 * page, «مرتجع» for the invoices), by route. Only the plain words: the page's own name always matches.
 */
export const PAGE_KEYWORDS: Readonly<Record<string, string>> = {
  '/': 'الصفحة الرئيسية لوحة البيانات dashboard home',
  '/sales/today': 'اليوم صندوق مبيعات يومية',
  '/sales/invoices': 'فاتورة فواتير مرتجع ارجاع بيع invoice return',
  '/quotations': 'عرض سعر قوته quote',
  '/shifts': 'وردية ورديات صندوق اغلاق كاشير shift',
  '/customers': 'زبون عميل ديون دين customer قسيمه قسائم ولاء نقاط واتساب كشف حساب',
  '/installments': 'قسط اقساط تقسيط دفعات',
  '/cheques': 'شيك صك بنك',
  '/rentals': 'ايجار تاجير كراء',
  '/online-store': 'متجر اونلاين طلبات الكترونية موقع shop تتبع طلب',
  '/products': 'منتج بضاعة صنف اصناف سلعة قميص بنطلون product item',
  '/categories': 'تصنيف قسم اقسام فئة',
  '/prices': 'سعر اسعار تسعير غلاء دولار',
  '/price-list': 'سعر اسعار اكسل ملف excel',
  '/labels': 'ملصق ملصقات باركود طباعة barcode',
  '/import': 'استيراد رفع اكسل excel ملف',
  '/promotions': 'عرض عروض حسم تخفيض خصم offer',
  '/purchases': 'شراء مشتريات فاتورة مورد purchase',
  '/purchase-orders': 'طلبية طلب شراء مورد',
  '/suppliers': 'مورد تاجر موردين supplier',
  '/supplier-returns': 'مرتجع رد مورد',
  '/expenses': 'مصروف مصاريف ايجار راتب كهرباء expense',
  '/messages': 'واتساب رسائل تذكير بث',
  '/serials': 'رقم تسلسلي سيريال تتبع ضمان',
  '/inventory': 'مخزون جرد ارباح كمية stock',
  '/transfers': 'تحويل نقل فرع مستودع',
  '/damaged-stock': 'تالف تلف بضاعة تالفه',
  '/expiry': 'صلاحيه انتهاء تاريخ دواء',
  '/reports': 'تقرير تقارير report',
  '/reports/sales': 'مبيعات تقرير',
  '/accounting': 'محاسبه دفتر قيد حساب ميزان ledger قيود ميزانيه ميزان المراجعه كشف حساب يوميه',
  '/settings': 'اعدادات متجر عمله سعر الصرف دولار ليره عملات ضريبه طباعه',
  '/branches': 'فرع فروع branch',
  '/staff': 'موظف موظفين مستخدم صلاحيه كاشير رمز pin صلاحيات سر رقم سري',
  '/tax-rates': 'ضريبه ضرائب tax',
  '/devices': 'جهاز اجهزه كاشير طابعه تتبع',
  '/subscription': 'اشتراك باقه دفع تجديد فاتوره plan',
};
