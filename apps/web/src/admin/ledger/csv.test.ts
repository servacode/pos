import { describe, expect, it } from 'vitest';
import { statementWhat } from './csv';

describe('what a cheque line on a statement is called', () => {
  it('says «شيك مرتجع» for a cheque that came back, and «تحصيل شيك» for one cashed', () => {
    expect(statementWhat({ sourceType: 'cheque', memo: 'رد شيك 55 من زبون', debitMinor: 100 })).toBe(
      'شيك مرتجع',
    );
    expect(statementWhat({ sourceType: 'cheque', memo: 'شيك 55', debitMinor: 100 })).toBe('شيك مرتجع');
    expect(statementWhat({ sourceType: 'cheque', memo: 'تحصيل شيك 55', debitMinor: 0 })).toBe('تحصيل شيك');
    expect(statementWhat({ sourceType: 'receipt', memo: 'x' })).toBe('سند قبض');
  });
});
