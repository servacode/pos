import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderUi } from '../test/render';
import { ShareBar } from './ShareBar';

const methods = [
  { key: 'cash', label: 'نقدي', value: 6100 },
  { key: 'sham', label: 'شام كاش', value: 2400 },
  { key: 'card', label: 'بطاقة', value: 1500 },
];

function measure(element: Element, left: number, width: number) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: left,
    y: 0,
    left,
    top: 0,
    width,
    height: 8,
    right: left + width,
    bottom: 8,
    toJSON: () => ({}),
  });
}

describe('ShareBar', () => {
  it("names the whole and lists every part's amount and share as text", () => {
    renderUi(<ShareBar label="طرق الدفع اليوم" parts={methods} formatValue={(v) => `${v} ل.س`} />);
    expect(screen.getByRole('img', { name: 'طرق الدفع اليوم' })).toBeInTheDocument();
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'نقدي6100 ل.س61%',
      'شام كاش2400 ل.س24%',
      'بطاقة1500 ل.س15%',
    ]);
  });

  it('names every part in the bar itself when it stands without its list', () => {
    renderUi(<ShareBar label="طرق الدفع" parts={methods} legend={false} />);
    expect(
      screen.getByRole('img', {
        name: 'طرق الدفع: نقدي 6,100 (61%)، شام كاش 2,400 (24%)، بطاقة 1,500 (15%).',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('folds the parts after the fifth into «أخرى», never a seventh colour', () => {
    const many = ['أ', 'ب', 'ج', 'د', 'ه', 'و', 'ز'].map((label, index) => ({
      key: label,
      label,
      value: 10 - index,
    }));
    renderUi(<ShareBar label="الأقسام" parts={many} />);
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows).toHaveLength(6);
    expect(rows[5]).toHaveTextContent('أخرى9');
  });

  it('opens the first part on keyboard focus; the arrows follow the bar from the right', async () => {
    const { user } = renderUi(<ShareBar label="طرق الدفع اليوم" parts={methods} />);
    await user.tab();
    const slider = screen.getByRole('slider', { name: 'طرق الدفع اليوم' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('نقدي');
    expect(screen.getByRole('tooltip')).toHaveTextContent('6,100 · 61%');

    await user.keyboard('{ArrowLeft}');
    expect(slider).toHaveAttribute('aria-valuetext', 'شام كاش: 2,400، 24%');
    expect(screen.getByRole('tooltip')).toHaveTextContent('شام كاش');
  });

  it('reads the part under the pointer', () => {
    const { container } = renderUi(<ShareBar label="طرق الدفع اليوم" parts={methods} />);
    const blocks = container.querySelectorAll('[data-index]');
    // From the right in Arabic: نقدي 400–600, شام كاش 240–400, بطاقة 0–240 (gaps aside).
    measure(blocks[0]!, 400, 200);
    measure(blocks[1]!, 240, 158);
    measure(blocks[2]!, 0, 238);
    const slider = screen.getByRole('slider', { name: 'طرق الدفع اليوم' });

    fireEvent(slider, new MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 4 }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('شام كاش');
    fireEvent.pointerLeave(slider);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('draws an empty track and says so when the whole is zero', () => {
    renderUi(<ShareBar label="طرق الدفع اليوم" parts={[{ key: 'cash', label: 'نقدي', value: 0 }]} />);
    expect(screen.getByRole('img', { name: 'طرق الدفع اليوم: لا بيانات' })).toBeInTheDocument();
    expect(screen.getByText('لا بيانات لعرضها بعد.')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });
});
