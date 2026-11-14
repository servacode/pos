import { z } from 'zod';

/** The type names zod prints in English, as a person says them. */
const TYPE_NAMES: Record<string, string> = {
  number: 'رقم',
  int: 'رقم صحيح',
  string: 'نص',
  boolean: 'نعم أو لا',
  array: 'قائمة',
  object: 'بيانات',
  bigint: 'رقم',
  date: 'تاريخ',
  null: 'لا شيء',
  undefined: 'لا شيء',
};

const typeName = (name: unknown): string => TYPE_NAMES[String(name)] ?? 'قيمة صالحة';

/**
 * Every message a schema does not word itself comes out in Arabic: a missing field, a wrong type, a
 * number out of range. A form never shows «Invalid input», and the built-in Arabic wording that
 * leaves «number» or «>= 0» in English is replaced for numbers and wrong types. Messages written on
 * the schemas win.
 */
z.config({
  ...z.locales.ar(),
  customError: (issue) => {
    if (issue.code === 'too_small' && issue.origin === 'number') {
      return issue.inclusive === false
        ? `يجب أن تكون القيمة أكبر من ${String(issue.minimum)}`
        : `يجب ألا تقل القيمة عن ${String(issue.minimum)}`;
    }
    if (issue.code === 'too_big' && issue.origin === 'number') {
      return issue.inclusive === false
        ? `يجب أن تكون القيمة أصغر من ${String(issue.maximum)}`
        : `يجب ألا تزيد القيمة عن ${String(issue.maximum)}`;
    }
    if (issue.code === 'invalid_type') return `القيمة غير صالحة: المطلوب ${typeName(issue.expected)}`;
    return undefined;
  },
});
