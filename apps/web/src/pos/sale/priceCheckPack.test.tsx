import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../catalog';
import { PriceCheckCard } from './ItemsArea';

const piece = {
  variantId: 'v1',
  name: 'قفازات',
  price: { priceMinor: 1_000, currency: 'SYP' },
  stockQty: 480_000,
};

describe('the price checker on a scanned box', () => {
  it('says the stock in boxes and loose pieces, with the pieces in all', () => {
    render(
      <PriceCheckCard
        check={{
          name: 'قفازات',
          pieces: [piece as unknown as CatalogItem],
          focus: 'v1',
          pack: { name: null, qty: 100_000, priceMinor: 100_000, currency: 'SYP' },
        }}
      />,
    );
    expect(screen.getByText(/المتوفر 4 علب و80 قطعة \(480 قطعة\)/)).toBeInTheDocument();
  });

  it('keeps the plain number for a piece that was scanned', () => {
    render(
      <PriceCheckCard check={{ name: 'قفازات', pieces: [piece as unknown as CatalogItem], focus: 'v1' }} />,
    );
    expect(screen.getByText('المتوفر 480')).toBeInTheDocument();
  });
});
