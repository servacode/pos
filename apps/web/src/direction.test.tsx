import type * as RadixDirection from '@radix-ui/react-direction';
import { screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mockFetch } from './test/fetchMock';
import { signedOutRefresh } from './test/fixtures';
import { renderApp } from './test/renderApp';

// Wraps Radix's real provider so the test can see which direction the app gives it, and where.
vi.mock('@radix-ui/react-direction', async (importOriginal) => {
  const radix = await importOriginal<typeof RadixDirection>();
  function RecordingDirectionProvider(props: ComponentProps<typeof radix.DirectionProvider>) {
    return (
      <div data-testid="radix-direction" data-dir={props.dir}>
        <radix.DirectionProvider {...props} />
      </div>
    );
  }
  return { ...radix, DirectionProvider: RecordingDirectionProvider, Provider: RecordingDirectionProvider };
});

describe('Radix direction', () => {
  it('wraps the app in an RTL DirectionProvider', async () => {
    mockFetch({ 'POST /v1/auth/refresh': signedOutRefresh });
    renderApp('/login');

    const heading = await screen.findByRole('heading', { name: 'أهلاً بعودتك' });
    const provider = screen.getByTestId('radix-direction');
    expect(provider).toHaveAttribute('data-dir', 'rtl');
    expect(provider).toContainElement(heading);
  });

  it('wraps the cashier app too', async () => {
    renderApp('/pos');

    const heading = await screen.findByRole('heading', { name: 'هذا الجهاز غير مربوط بمتجر بعد' });
    expect(screen.getByTestId('radix-direction')).toContainElement(heading);
  });
});
