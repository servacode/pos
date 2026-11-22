import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearReportCache, rememberAnswer, SLOW_AFTER_MS, useReport } from './useReport';

beforeEach(() => {
  clearReportCache();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const never = () => new Promise<string>(() => undefined);

describe('useReport › slow', () => {
  it('turns slow after ten seconds without any answer, and not before', () => {
    const { result } = renderHook(() => useReport('k', never));
    expect(result.current.slow).toBe(false);
    act(() => {
      vi.advanceTimersByTime(SLOW_AFTER_MS - 1);
    });
    expect(result.current.slow).toBe(false);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(result.current.slow).toBe(true);
    expect(result.current.loading).toBe(true);
  });

  it('is never slow while the last answer is on screen', () => {
    rememberAnswer('screen|k', 'old');
    const { result } = renderHook(() => useReport('k', never, { cache: 'screen' }));
    act(() => {
      vi.advanceTimersByTime(SLOW_AFTER_MS + 1);
    });
    expect(result.current.data).toBe('old');
    expect(result.current.slow).toBe(false);
  });
});
