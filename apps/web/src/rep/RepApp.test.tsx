import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test/renderApp';

describe('the rep’s phone (/rep)', () => {
  it('shows the placeholder until the rep mode arrives', async () => {
    renderApp('/rep');
    expect(await screen.findByRole('heading', { name: 'وضع المندوب — قريباً' })).toBeInTheDocument();
  });

  it('opens the same page from the link a rep_phone pairing carries', async () => {
    renderApp('/link?kind=rep_phone');
    expect(await screen.findByRole('heading', { name: 'وضع المندوب — قريباً' })).toBeInTheDocument();
  });
});
