import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderUi } from './test/render';
import { ScrollStrip, SnapRow } from './Scroller';

/** jsdom has no layout: give an element the sizes a scrolling row would have. */
function sized(el: HTMLElement, metrics: { scrollWidth: number; clientWidth: number; scrollLeft?: number }) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: metrics.scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: metrics.clientWidth });
  Object.defineProperty(el, 'scrollLeft', {
    configurable: true,
    writable: true,
    value: metrics.scrollLeft ?? 0,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('ScrollStrip', () => {
  it('draws no fade while everything fits', () => {
    const { container } = renderUi(
      <ScrollStrip>
        <a href="/a">أ</a>
      </ScrollStrip>,
    );
    const strip = container.querySelector('[data-fade-left], [data-fade-right]');
    expect(strip).toBeNull();
  });

  it('fades the edge that hides more, in Arabic the left one at the start, and the right once scrolled', () => {
    const { container } = renderUi(
      <ScrollStrip>
        <a href="/a">أ</a>
      </ScrollStrip>,
    );
    const strip = container.firstElementChild!.firstElementChild as HTMLElement;
    // The page is right to left: the strip starts at the right and more waits on the left
    sized(strip, { scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
    fireEvent.scroll(strip);
    expect(strip).toHaveAttribute('data-fade-left');
    expect(strip).not.toHaveAttribute('data-fade-right');
    expect(strip.style.maskImage).toContain('transparent');

    // Scrolled to the end (negative in RTL): now the right edge hides the start
    act(() => {
      strip.scrollLeft = -300;
      fireEvent.scroll(strip);
    });
    expect(strip).not.toHaveAttribute('data-fade-left');
    expect(strip).toHaveAttribute('data-fade-right');
  });

  it('brings the open tab into view', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderUi(
      <ScrollStrip>
        <a href="/a">أ</a>
        <a href="/b" aria-current="page">
          ب
        </a>
      </ScrollStrip>,
    );
    expect(scrollIntoView).toHaveBeenCalledWith({ inline: 'center', block: 'nearest' });
  });
});

describe('SnapRow', () => {
  it('shows a dot per card when they scroll, marks the one in view, and brings a card in on tap', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const box = (left: number, width: number) =>
      ({
        left,
        width,
        right: left + width,
        top: 0,
        bottom: 0,
        height: 0,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.getAttribute('data-card') === '0') return box(-200, 200);
      if (this.getAttribute('data-card') === '1') return box(10, 200);
      if (this.getAttribute('data-card') === '2') return box(220, 200);
      return box(0, 300);
    });
    const { container, user } = renderUi(
      <SnapRow className="row">
        <div data-card="0" />
        <div data-card="1" />
        <div data-card="2" />
      </SnapRow>,
    );
    const row = container.querySelector('.row') as HTMLElement;
    // Nothing scrolls yet: no dots
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    sized(row, { scrollWidth: 640, clientWidth: 300 });
    act(() => {
      fireEvent.scroll(row);
    });
    const dots = screen.getAllByRole('button');
    expect(dots).toHaveLength(3);
    // Card 1 is the one in the middle of the row
    expect(dots[1]).toHaveAttribute('aria-current', 'true');
    expect(dots[0]).not.toHaveAttribute('aria-current');
    await user.click(dots[2]!);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    spy.mockRestore();
  });
});
