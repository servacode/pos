import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderUi } from '../test/render';
import { Sparkline } from './Sparkline';

/** The latest value's dot: the one element placed in percent of the box. */
function dot(container: HTMLElement): HTMLElement {
  return container.querySelector('span[style]') as HTMLElement;
}

describe('Sparkline', () => {
  it('is decorative by default, and an image when it says what it shows', () => {
    const { container, unmount } = renderUi(<Sparkline values={[3, 5, 4, 8]} />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    unmount();

    renderUi(<Sparkline values={[3, 5, 4, 8]} label="المبيعات آخر 4 أيام: في ارتفاع" />);
    expect(screen.getByRole('img', { name: 'المبيعات آخر 4 أيام: في ارتفاع' })).toBeInTheDocument();
  });

  it('marks the latest value at the left in Arabic, at the right when time runs from the left', () => {
    const { container, unmount } = renderUi(<Sparkline values={[3, 5, 4, 8]} />);
    expect(dot(container).style.left).toBe('0%');
    // The highest value sits at the top of the drawing (with its inset).
    expect(parseFloat(dot(container).style.top)).toBeLessThan(20);
    unmount();

    const ltr = renderUi(<Sparkline values={[3, 5, 4, 8]} direction="ltr" />);
    expect(dot(ltr.container).style.left).toBe('100%');
  });

  it('draws a level dashed baseline, with no wash, when only the latest day has a value', () => {
    const { container } = renderUi(<Sparkline values={[0, 0, 0, 0, 0, 0, 5]} />);
    const line = container.querySelector('svg path[stroke]') as SVGPathElement;
    expect(line.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(line.getAttribute('d')).toMatch(/^M[\d.]+ 18\.00L/);
    expect(container.querySelector('linearGradient')).not.toBeInTheDocument();
    expect(dot(container).style.left).toBe('0%');
    expect(parseFloat(dot(container).style.top)).toBe(50);
  });

  it('draws a real trend when earlier days have values', () => {
    const { container } = renderUi(<Sparkline values={[0, 2, 0, 5]} />);
    const line = container.querySelector('svg path[stroke]') as SVGPathElement;
    expect(line.getAttribute('stroke-dasharray')).toBeNull();
    expect(container.querySelector('linearGradient')).toBeInTheDocument();
  });

  it('draws nothing with fewer than two values', () => {
    const { container } = renderUi(<Sparkline values={[5]} label="المبيعات" />);
    expect(container.querySelector('svg')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
