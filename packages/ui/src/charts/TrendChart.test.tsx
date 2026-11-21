import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderUi } from '../test/render';
import { AreaChart, LineChart } from './TrendChart';

const labels = ['1/11', '2/11', '3/11', '4/11', '5/11'];
const sales = { key: 'sales', label: 'المبيعات', values: [1200, 800, 1500, 900, 1300] };
const lastWeek = { key: 'before', label: 'الأسبوع الماضي', values: [1000, 1100, 700, 1250, 950] };

/** The explorer's box, as the browser would measure it (jsdom lays nothing out). */
function measure(element: Element, width: number, height: number) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  });
}

/** jsdom has no PointerEvent: a MouseEvent of the pointer's type carries the coordinates React reads. */
function pointAt(element: Element, clientX: number, clientY = 40) {
  fireEvent(element, new MouseEvent('pointermove', { bubbles: true, clientX, clientY }));
}

describe('AreaChart', () => {
  it('names the chart with a summary of its values', () => {
    renderUi(<AreaChart label="المبيعات آخر 5 أيام" labels={labels} series={[sales]} />);
    expect(
      screen.getByRole('img', {
        name: 'المبيعات آخر 5 أيام، من 1/11 إلى 5/11. الأعلى 1,500 في 3/11، والأخير 1,300 في 5/11.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'المبيعات آخر 5 أيام' })).toHaveAttribute(
      'aria-valuetext',
      '5/11: 1,300',
    );
  });

  it('has no legend for one series and a legend for two', () => {
    const { unmount } = renderUi(<AreaChart label="المبيعات" labels={labels} series={[sales]} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    unmount();

    renderUi(<AreaChart label="المبيعات" labels={labels} series={[sales, lastWeek]} />);
    const legend = screen.getByRole('list');
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['المبيعات', 'الأسبوع الماضي']);
  });

  it('opens the readout at the latest point on keyboard focus; the arrows walk in the drawn direction', async () => {
    const { user } = renderUi(
      <AreaChart
        label="المبيعات"
        labels={labels}
        series={[sales, lastWeek]}
        formatValue={(v) => `${v} ل.س`}
      />,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.tab();
    const slider = screen.getByRole('slider', { name: 'المبيعات' });
    expect(slider).toHaveFocus();
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('5/11');
    expect(tip).toHaveTextContent('المبيعات1300 ل.س');
    expect(tip).toHaveTextContent('الأسبوع الماضي950 ل.س');

    // Time runs from the right: the right arrow goes back in time, the left one forward.
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(slider).toHaveAttribute('aria-valuenow', '2');
    expect(slider).toHaveAttribute('aria-valuetext', '3/11: المبيعات 1500 ل.س، الأسبوع الماضي 700 ل.س');
    expect(screen.getByRole('tooltip')).toHaveTextContent('3/11');
    await user.keyboard('{ArrowLeft}');
    expect(slider).toHaveAttribute('aria-valuenow', '3');
    await user.keyboard('{Home}');
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('reads the point under the pointer: the oldest at the right in Arabic', () => {
    renderUi(<AreaChart label="المبيعات" labels={labels} series={[sales]} />);
    const slider = screen.getByRole('slider', { name: 'المبيعات' });
    measure(slider, 640, 220);

    pointAt(slider, 630);
    expect(screen.getByRole('tooltip')).toHaveTextContent('1/11');
    expect(screen.getByRole('tooltip')).toHaveTextContent('1,200');

    pointAt(slider, 4);
    expect(screen.getByRole('tooltip')).toHaveTextContent('5/11');

    fireEvent.pointerLeave(slider);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('lays time from the right by default, and from the left when asked', () => {
    const left = (index: number) =>
      parseFloat((document.querySelector(`[data-index="${index}"]`) as HTMLElement).style.left);

    const { unmount } = renderUi(<AreaChart label="المبيعات" labels={labels} series={[sales]} />);
    expect(left(0)).toBeGreaterThan(left(4));
    unmount();

    renderUi(<LineChart label="المبيعات" labels={labels} series={[sales]} direction="ltr" />);
    expect(left(0)).toBeLessThan(left(4));
  });

  it('steps forward with the right arrow when time runs from the left', async () => {
    const { user } = renderUi(
      <LineChart label="المبيعات" labels={labels} series={[sales]} direction="ltr" />,
    );
    await user.tab();
    const slider = screen.getByRole('slider', { name: 'المبيعات' });
    await user.keyboard('{Home}{ArrowRight}');
    expect(slider).toHaveAttribute('aria-valuenow', '1');
  });

  it('shows every value as a table when asked', () => {
    renderUi(
      <AreaChart
        label="المبيعات آخر 5 أيام"
        labels={labels}
        series={[sales, lastWeek]}
        formatValue={(v) => `${v} ل.س`}
        view="table"
      />,
    );
    const table = screen.getByRole('table', { name: 'المبيعات آخر 5 أيام' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['التاريخ', 'المبيعات', 'الأسبوع الماضي']);
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(within(table).getByRole('row', { name: '3/11 1500 ل.س 700 ل.س' })).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('shows an empty state with no points', () => {
    renderUi(<AreaChart label="المبيعات" labels={[]} series={[]} />);
    expect(screen.getByText('لا بيانات لعرضها بعد.')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it("shows the screen's own empty state when no value is known", () => {
    renderUi(
      <AreaChart
        label="المبيعات"
        labels={labels}
        series={[{ ...sales, values: [null, null] }]}
        empty="لا مبيعات بعد"
      />,
    );
    expect(screen.getByText('لا مبيعات بعد')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('holds a placeholder during the first load, and dims the drawn chart during the next', () => {
    const { container, unmount } = renderUi(<AreaChart label="المبيعات" labels={[]} series={[]} loading />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText('لا بيانات لعرضها بعد.')).not.toBeInTheDocument();
    unmount();

    renderUi(<AreaChart label="المبيعات" labels={labels} series={[sales]} loading />);
    expect(screen.getByRole('img')).toHaveClass('opacity-50');
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });
});
