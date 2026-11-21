import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderUi } from '../test/render';
import { BarChart } from './BarChart';

const hours = ['10:00', '11:00', '12:00', '13:00'];
const invoices = { key: 'n', label: 'الفواتير', values: [3, 8, 12, 5] };
const products = ['بنطال جينز رجالي', 'فستان سهرة', 'تيشيرت قطن'];
const now = { key: 'now', label: 'هذا الشهر', values: [4850, 3920, 2640] };
const before = { key: 'before', label: 'الشهر الماضي', values: [4100, 4300, 1900] };

function measure(element: Element, rect: { left: number; top: number; width: number; height: number }) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    ...rect,
    x: rect.left,
    y: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => ({}),
  });
}

/** jsdom has no PointerEvent: a MouseEvent of the pointer's type carries the coordinates React reads. */
function pointAt(element: Element, clientX: number, clientY: number) {
  fireEvent(element, new MouseEvent('pointermove', { bubbles: true, clientX, clientY }));
}

describe('BarChart, columns', () => {
  it('names the chart with every value and prints each value on its column', () => {
    renderUi(<BarChart label="الفواتير حسب الساعة" labels={hours} series={[invoices]} />);
    expect(
      screen.getByRole('img', { name: 'الفواتير حسب الساعة: 10:00 3، 11:00 8، 12:00 12، 13:00 5.' }),
    ).toBeInTheDocument();
    const drawing = screen.getByRole('img');
    for (const value of ['3', '8', '12', '5']) expect(within(drawing).getByText(value)).toBeInTheDocument();
    // Every value is on its column, so the value axis steps back.
    expect(within(drawing).queryByText('0')).not.toBeInTheDocument();
  });

  it('starts from the right in Arabic, and from the left when asked', () => {
    const left = (index: number) =>
      parseFloat((document.querySelector(`[data-index="${index}"]`) as HTMLElement).style.left);
    const { unmount } = renderUi(<BarChart label="الفواتير" labels={hours} series={[invoices]} />);
    expect(left(0)).toBeGreaterThan(left(3));
    unmount();

    renderUi(<BarChart label="الفواتير" labels={hours} series={[invoices]} direction="ltr" />);
    expect(left(0)).toBeLessThan(left(3));
  });

  it('reads every series of a column on keyboard focus and steps with the arrows', async () => {
    const { user } = renderUi(<BarChart label="المبيعات" labels={products} series={[now, before]} />);
    expect(screen.getByRole('list')).toHaveTextContent('هذا الشهرالشهر الماضي');

    await user.tab();
    const slider = screen.getByRole('slider', { name: 'المبيعات' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('تيشيرت قطن');
    expect(screen.getByRole('tooltip')).toHaveTextContent('هذا الشهر2,640');
    expect(screen.getByRole('tooltip')).toHaveTextContent('الشهر الماضي1,900');

    await user.keyboard('{ArrowRight}');
    expect(slider).toHaveAttribute('aria-valuetext', 'فستان سهرة: هذا الشهر 3,920، الشهر الماضي 4,300');
  });

  it('reads the column under the pointer', () => {
    renderUi(<BarChart label="الفواتير" labels={hours} series={[invoices]} />);
    const slider = screen.getByRole('slider', { name: 'الفواتير' });
    measure(slider, { left: 0, top: 0, width: 640, height: 220 });

    // Four columns of 160 px from the right: 600 is in the first.
    pointAt(slider, 600, 100);
    expect(screen.getByRole('tooltip')).toHaveTextContent('10:00');
    pointAt(slider, 40, 100);
    expect(screen.getByRole('tooltip')).toHaveTextContent('13:00');
  });

  it('shows the values as a table when asked, and an empty state with none', () => {
    const { unmount } = renderUi(
      <BarChart
        label="الفواتير حسب الساعة"
        labelHeader="الساعة"
        labels={hours}
        series={[invoices]}
        view="table"
      />,
    );
    const table = screen.getByRole('table', { name: 'الفواتير حسب الساعة' });
    expect(within(table).getByRole('row', { name: '12:00 12' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'الساعة' })).toBeInTheDocument();
    unmount();

    renderUi(<BarChart label="الفواتير" labels={hours} series={[{ ...invoices, values: [] }]} />);
    expect(screen.getByText('لا بيانات لعرضها بعد.')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });
});

describe('BarChart, rows', () => {
  it('lists each name with its value at the tip of its bar', () => {
    renderUi(
      <BarChart
        label="الأكثر مبيعاً"
        orientation="horizontal"
        labels={products}
        series={[now]}
        formatValue={(v) => `${v} ل.س`}
      />,
    );
    const drawing = screen.getByRole('img', {
      name: 'الأكثر مبيعاً: بنطال جينز رجالي 4850 ل.س، فستان سهرة 3920 ل.س، تيشيرت قطن 2640 ل.س.',
    });
    expect(within(drawing).getByText('فستان سهرة')).toBeInTheDocument();
    expect(within(drawing).getByText('3920 ل.س')).toBeInTheDocument();
  });

  it('opens the first row on keyboard focus and walks down with the arrows', async () => {
    const { user } = renderUi(
      <BarChart label="الأكثر مبيعاً" orientation="horizontal" labels={products} series={[now, before]} />,
    );
    await user.tab();
    const slider = screen.getByRole('slider', { name: 'الأكثر مبيعاً' });
    expect(slider).toHaveAttribute('aria-orientation', 'vertical');
    expect(screen.getByRole('tooltip')).toHaveTextContent('بنطال جينز رجالي');

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('تيشيرت قطن');
    expect(slider).toHaveAttribute('aria-valuetext', 'تيشيرت قطن: هذا الشهر 2,640، الشهر الماضي 1,900');
  });

  it('reads the row under the pointer', () => {
    const { container } = renderUi(
      <BarChart label="الأكثر مبيعاً" orientation="horizontal" labels={products} series={[now]} />,
    );
    const rows = container.querySelectorAll('[data-index]');
    rows.forEach((row, index) => measure(row, { left: 0, top: index * 40, width: 600, height: 36 }));
    const slider = screen.getByRole('slider', { name: 'الأكثر مبيعاً' });
    measure(slider, { left: 0, top: 0, width: 600, height: 116 });

    pointAt(slider, 300, 50);
    expect(screen.getByRole('tooltip')).toHaveTextContent('فستان سهرة');
    expect(screen.getByRole('tooltip')).toHaveTextContent('3,920');
    fireEvent.pointerLeave(slider);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
