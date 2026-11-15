import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Kbd } from './Kbd';

describe('a keyboard hint', () => {
  it('stays hidden on a touch screen or a phone-width window, and shows only for a mouse on a wide one', () => {
    const { container } = render(
      <>
        <Kbd>F12</Kbd>
        <Kbd always>Esc</Kbd>
      </>,
    );
    const [hint, guide] = [...container.querySelectorAll('kbd')];
    expect(hint!.className).toContain('hidden');
    expect(hint!.className).toContain('md:pointer-fine:inline-block');
    expect(guide!.className).toContain('inline-block');
    expect(guide!.className).not.toContain('hidden');
  });
});
