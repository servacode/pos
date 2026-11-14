import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import './zod-locale';

const message = (schema: z.ZodType, value: unknown) => {
  const r = schema.safeParse(value);
  return r.success ? null : r.error.issues[0]!.message;
};

describe('the Arabic wording of zod errors', () => {
  it('words number bounds without English or symbols', () => {
    expect(message(z.number().min(0), -1)).toBe('يجب ألا تقل القيمة عن 0');
    expect(message(z.number().gt(0), 0)).toBe('يجب أن تكون القيمة أكبر من 0');
    expect(message(z.number().max(5), 6)).toBe('يجب ألا تزيد القيمة عن 5');
    expect(message(z.number().lt(5), 5)).toBe('يجب أن تكون القيمة أصغر من 5');
  });
  it('words a wrong type with its Arabic name', () => {
    expect(message(z.number(), 'x')).toBe('القيمة غير صالحة: المطلوب رقم');
    expect(message(z.string(), 1)).toBe('القيمة غير صالحة: المطلوب نص');
    expect(message(z.symbol(), 1)).toBe('القيمة غير صالحة: المطلوب قيمة صالحة');
  });
  it('leaves other messages to the Arabic locale and to the schemas', () => {
    expect(message(z.string().min(3), 'a')).toMatch(/[\u0600-\u06FF]/);
    expect(message(z.number().min(0, 'سالب'), -1)).toBe('سالب');
  });
});
