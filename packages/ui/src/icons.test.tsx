import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ArchiveIcon, CategoriesIcon, CheckIcon, HomeIcon, LogoutIcon, QrCodeIcon, SendIcon } from './icons';

function svgOf(element: ReactElement): SVGSVGElement {
  const { container } = render(<div dir="rtl">{element}</div>);
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('No <svg> rendered');
  return svg;
}

describe('icons', () => {
  it('renders Lucide glyphs at the tab-14 default: 20 px, stroke 1.75, hidden from screen readers', () => {
    const svg = svgOf(<HomeIcon />);

    expect(svg).toHaveClass('lucide-house');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('stroke-width', '1.75');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('follows the size with the stroke from tab 14', () => {
    expect(svgOf(<CheckIcon size={16} />)).toHaveAttribute('stroke-width', '2');
    expect(svgOf(<HomeIcon size={48} />)).toHaveAttribute('stroke-width', '1.5');
  });

  it('mirrors directional icons in RTL by itself', () => {
    expect(svgOf(<LogoutIcon />)).toHaveClass('rtl:-scale-x-100');
  });

  it('never mirrors non-directional icons', () => {
    expect(svgOf(<CheckIcon />)).not.toHaveClass('rtl:-scale-x-100');
  });

  it('has the device-linking glyphs, and a paper plane is not a direction', () => {
    expect(svgOf(<QrCodeIcon />)).toHaveClass('lucide-qr-code');
    expect(svgOf(<SendIcon />)).not.toHaveClass('rtl:-scale-x-100');
  });

  it('has the catalog glyphs: the category tree and the archive', () => {
    expect(svgOf(<CategoriesIcon />)).toHaveClass('lucide-folder-tree');
    expect(svgOf(<ArchiveIcon />)).toHaveClass('lucide-archive');
    expect(svgOf(<CategoriesIcon />)).not.toHaveClass('rtl:-scale-x-100');
  });
});
