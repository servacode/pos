import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CategorizeDialog } from './CategorizeDialog';

const products = [
  { id: 'p1', nameAr: 'محرار رقمي', version: 1, categoryId: null },
  { id: 'p2', nameAr: 'شيء غير معروف', version: 1, categoryId: null },
];

describe('CategorizeDialog', () => {
  it('applies the proposals for the products that have one and leaves the others as they are', () => {
    render(
      <CategorizeDialog
        open
        onClose={vi.fn()}
        onDone={vi.fn()}
        products={products}
        categories={[]}
        sectors={['medical_supplies']}
      />,
    );
    // the thermometer is proposed «أجهزة قياس»; the other name has no proposal
    expect(screen.getByRole('button', { name: 'طبّق على 1' })).toBeEnabled();
    expect(screen.getByText(/منتج واحد بلا اقتراح/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('تصنيف «شيء غير معروف»'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'طبّق على 1' })).toBeEnabled();
  });
});
