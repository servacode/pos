import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert } from './Alert';

describe('Alert', () => {
  it('draws success with the success tokens, not the brand ones', () => {
    render(<Alert tone="success">حُفظ المنتج</Alert>);

    const alert = screen.getByRole('status');
    expect(alert).toHaveClass('bg-success-soft', 'text-success-ink');
    expect(alert.className).not.toMatch(/\bbrand\b|-brand/);
  });

  it.each([
    ['error', 'alert', 'bg-danger-soft'],
    ['warning', 'status', 'bg-warning-soft'],
    ['info', 'status', 'bg-info-soft'],
  ] as const)('draws %s with its own status tokens', (tone, role, background) => {
    render(<Alert tone={tone}>نص</Alert>);

    expect(screen.getByRole(role)).toHaveClass(background);
  });

  it('is a rounded card with the tone’s icon and a semibold title over the -ink words', () => {
    render(
      <Alert tone="error" title="لم نستطع الحفظ">
        لا يوجد إنترنت الآن.
      </Alert>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('rounded-card', 'text-danger-ink');
    expect(alert.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('لم نستطع الحفظ')).toHaveClass('font-semibold');
    expect(alert).toHaveTextContent('لا يوجد إنترنت الآن.');
  });
});
