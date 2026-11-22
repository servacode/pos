import { describe, expect, it } from 'vitest';
import { customerInput } from './customers';
import { storeProfileInput } from './store';
import { supplierInput } from './purchases';

describe('contact phones in the forms', () => {
  it('a customer, a supplier and the store accept a mobile, a landline or nothing', () => {
    expect(customerInput.parse({ name: 'زبون', phone: '011 234 5678' }).phone).toBe(
      '+96311 2345678'.replace(' ', ''),
    );
    expect(customerInput.parse({ name: 'زبون', phone: '' }).phone).toBeNull();
    expect(customerInput.parse({ name: 'زبون' }).phone).toBeUndefined();
    expect(supplierInput.parse({ name: 'مورد', phone: '٠٩١٢٣٤٥٦٧٨' }).phone).toBe('+963912345678');
    expect(
      storeProfileInput.parse({ name: 'محل', sectors: ['general'], phone: '+963 11 234 5678' }).phone,
    ).toBe('+96311 2345678'.replace(' ', ''));
  });

  it('a wrong phone answers in Arabic, never «Invalid input»', () => {
    for (const parse of [
      () => customerInput.parse({ name: 'زبون', phone: '12' }),
      () => supplierInput.parse({ name: 'مورد', phone: 'abc' }),
      () => storeProfileInput.parse({ name: 'محل', sectors: ['general'], phone: '55' }),
      () => customerInput.parse({ name: 'زبون', phone: 5 }),
    ]) {
      const result = (() => {
        try {
          parse();
          return '';
        } catch (error) {
          return (error as Error).message;
        }
      })();
      expect(result).toContain('رقم الهاتف غير صحيح');
      expect(result).not.toContain('Invalid input');
    }
  });
});

describe('the dollar rate', () => {
  it('accepts thousands separators and Arabic digits', async () => {
    const { rateSchema } = await import('./store');
    expect(rateSchema.parse('14,500')).toBe('14500');
    expect(rateSchema.parse('١٤٬٥٠٠')).toBe('14500');
    expect(rateSchema.parse('14 500')).toBe('14500');
    expect(rateSchema.parse('130,5')).toBe('130.5');
    expect(rateSchema.parse('13,000.5')).toBe('13000.5');
    expect(rateSchema.safeParse('abc').success).toBe(false);
    expect(rateSchema.safeParse('0').success).toBe(false);
  });
});

describe('messages a schema does not word itself', () => {
  it('come out in Arabic', async () => {
    const { z } = await import('zod');
    await import('../zod-locale');
    const result = z.object({ n: z.int().positive() }).safeParse({ n: 'x' });
    expect(result.success).toBe(false);
    const message = result.error?.issues[0]?.message ?? '';
    expect(message).toMatch(/[؀-ۿ]/);
    expect(message).not.toContain('Invalid');
  });
});
