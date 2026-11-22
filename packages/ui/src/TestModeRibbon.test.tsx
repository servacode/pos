import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TestModeRibbon } from './TestModeRibbon';

describe('TestModeRibbon', () => {
  it('says plainly that this is a test copy, in the warning tokens, with no way to close it', () => {
    render(<TestModeRibbon />);

    const ribbon = screen.getByRole('note');
    expect(ribbon).toHaveTextContent('نسخة تجربة على الخادم المحلي');
    expect(ribbon).toHaveClass('bg-warning-soft', 'text-warning-ink', 'border-warning/25');
    expect(ribbon.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
