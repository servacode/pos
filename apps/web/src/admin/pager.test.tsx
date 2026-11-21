import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Paged } from './pager';

const ROWS = Array.from({ length: 5 }, (_, i) => `صف ${String(i + 1)}`);

function Demo({ rows = ROWS, tab = 'a' }: { rows?: string[]; tab?: string }) {
  return (
    <Paged
      key={tab}
      rows={rows}
      size={2}
      noun="الحركات"
      render={(page) => (
        <ul>
          {page.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      )}
    />
  );
}

const label = () => screen.getByRole('navigation', { name: 'الصفحات' }).querySelector('[aria-current]');

describe('Paged (rows in memory)', () => {
  it('shows one page at a time with its label and range, and moves both ways', () => {
    render(<Demo />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['صف 1', 'صف 2']);
    expect(label()).toHaveTextContent('صفحة 1 · الحركات من 1 إلى 2');
    expect(screen.getByRole('button', { name: 'الصفحة السابقة' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'الصفحة التالية' }));
    fireEvent.click(screen.getByRole('button', { name: 'الصفحة التالية' }));
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['صف 5']);
    expect(label()).toHaveTextContent('صفحة 3 · الحركات من 5 إلى 5');
    expect(screen.getByRole('button', { name: 'الصفحة التالية' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'الصفحة السابقة' }));
    expect(label()).toHaveTextContent('صفحة 2 · الحركات من 3 إلى 4');
  });

  it('a new key starts again at page 1, and one page shows no controls', () => {
    const { rerender } = render(<Demo />);
    fireEvent.click(screen.getByRole('button', { name: 'الصفحة التالية' }));
    expect(label()).toHaveTextContent('صفحة 2');
    rerender(<Demo tab="b" />);
    expect(label()).toHaveTextContent('صفحة 1');
    rerender(<Demo tab="c" rows={ROWS.slice(0, 2)} />);
    expect(screen.queryByRole('navigation', { name: 'الصفحات' })).not.toBeInTheDocument();
  });
});
