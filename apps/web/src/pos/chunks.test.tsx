import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { lazyChunk, preloadTill, TillBoundary } from './chunks';

describe('a till screen that fails to load', () => {
  it('shows a retry instead of a blank page, and the retry loads it again', async () => {
    const load = vi
      .fn<() => Promise<{ default: () => React.ReactNode }>>()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValue({ default: () => <p>الشاشة</p> });
    const Screen = lazyChunk(load);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <TillBoundary>
        <Suspense fallback={null}>
          <Screen />
        </Suspense>
      </TillBoundary>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('تعذّر فتح هذه الشاشة');
    await userEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByText('الشاشة')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('can go back to the sale from the error', async () => {
    const Broken = lazyChunk<() => null>(() => Promise.reject(new Error('offline')));
    const back = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <TillBoundary onBack={back}>
        <Suspense fallback={null}>
          <Broken />
        </Suspense>
      </TillBoundary>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'رجوع' }));
    expect(back).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('preloads every screen without throwing when a file is missing', () => {
    expect(() => preloadTill()).not.toThrow();
  });
});
