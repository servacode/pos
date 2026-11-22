import { describe, expect, it } from 'vitest';
import { chequeDetailsSchema, chequeReference } from './cheques';

describe('cheque details', () => {
  it('needs a bank, a number and a due day; the drawer is optional', () => {
    const ok = { bank: 'بنك سورية', number: '000123', dueDate: '2026-12-01' };
    expect(chequeDetailsSchema.safeParse(ok).success).toBe(true);
    expect(chequeDetailsSchema.safeParse({ ...ok, drawer: 'أحمد' }).success).toBe(true);
    expect(chequeDetailsSchema.safeParse({ ...ok, bank: ' ' }).success).toBe(false);
    expect(chequeDetailsSchema.safeParse({ ...ok, dueDate: '1/12/2026' }).success).toBe(false);
  });

  it('writes them as the one line the payment keeps as its reference, within 64 characters', () => {
    expect(chequeReference({ bank: 'بنك سورية', number: '000123', dueDate: '2026-12-01' })).toBe(
      'بنك سورية · 000123 · 2026-12-01',
    );
    expect(
      chequeReference({ bank: 'ب'.repeat(60), number: '1'.repeat(40), dueDate: '2026-12-01' }),
    ).toHaveLength(64);
  });
});
