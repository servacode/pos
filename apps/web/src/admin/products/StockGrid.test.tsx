import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { product, variant } from '../../test/catalog';
import { StockGrid } from './StockGrid';

const piece = (id: string, size: string, colour: string, main: number, mall: number) =>
  variant({
    id,
    label: `${size} · ${colour}`,
    attributes: [
      { name: 'المقاس', value: size },
      { name: 'اللون', value: colour },
    ],
    stock: [
      { branchId: 'b-main', branchName: 'الفرع الرئيسي', qty: main, reservedQty: 0 },
      { branchId: 'b-mall', branchName: 'فرع المول', qty: mall, reservedQty: 0 },
    ],
  });

describe('the stock of a model by size and colour', () => {
  it('shows each piece in every branch or in one, an empty cell for a piece never made, and zero as run out', async () => {
    const user = userEvent.setup();
    render(
      <StockGrid
        numberFormat="latn"
        product={product({
          variants: [
            piece('v1', 'M', 'أبيض', 3000, 2000),
            piece('v2', 'L', 'أبيض', 0, 0),
            piece('v3', 'M', 'أسود', 1000, 0),
          ],
        })}
      />,
    );
    const table = screen.getByRole('table', { name: 'المخزون حسب المقاس واللون' });
    const rows = within(table).getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual(['المقاس \\ اللونأبيضأسود', 'M51', 'L0—']);
    expect(within(table).getByLabelText('L · أبيض: 0')).toHaveClass('text-danger-ink');
    await user.selectOptions(screen.getByLabelText('الفرع'), 'b-mall');
    expect(within(table).getAllByRole('row')[1]!.textContent).toBe('M20');
  });

  it('shows nothing for a product of one piece', () => {
    const { container } = render(<StockGrid numberFormat="latn" product={product()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
